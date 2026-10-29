import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import Employee from "../models/employeeModel.js";
import User from "../models/userModel.js";
import Company from "../models/companyModel.js";
import EmployeeLoan from "../models/employeeLoanModel.js";
import Audit from "../models/auditModel.js";
import emailService from "../services/emailService.js";
import payrollService from "../services/payrollService.js";

function validateBankDetails(bankDetails, firstName, lastName) {
  const errors = [];
  const warnings = [];

  if (bankDetails) {
    // Account number: must be exactly 10 digits
    if (bankDetails.accountNumber) {
      if (!/^\d{10}$/.test(bankDetails.accountNumber)) {
        errors.push("Account number must be exactly 10 digits (NUBAN format)");
      }
    }

    // Bank code: must be exactly 3 digits
    if (bankDetails.bankCode) {
      if (!/^\d{3}$/.test(bankDetails.bankCode)) {
        errors.push("Bank code must be exactly 3 digits");
      }
    }

    // Account name: warn if neither first nor last name appears
    if (bankDetails.accountName && firstName && lastName) {
      const accountNameLower = bankDetails.accountName.toLowerCase();
      const firstNameLower = firstName.toLowerCase();
      const lastNameLower = lastName.toLowerCase();

      const nameMatch =
        accountNameLower.includes(firstNameLower) ||
        accountNameLower.includes(lastNameLower);

      if (!nameMatch) {
        warnings.push(
          `Account name "${bankDetails.accountName}" does not appear to match the employee's name (${firstName} ${lastName}). Please verify this is the correct account.`,
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validates Nigerian phone number format.
 *
 * Must be +234XXXXXXXXXX — 13 characters total.
 */
function validatePhoneFormat(phone) {
  if (!phone) return true;

  return /^\+234\d{10}$/.test(phone);
}

class EmployeeController {
  /**
   * Create new employee
   * POST /api/employees
   */
  async createEmployee(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;

      const {
        email,
        firstName,
        lastName,
        phone,
        position,
        department,
        employmentType,
        startDate,
        salary,
        bankDetails,
        taxInformation,
        manager,
        nextOfKin,
      } = req.body;

      // Validate required fields
      if (
        !email ||
        !firstName ||
        !lastName ||
        !phone ||
        !position ||
        !startDate ||
        !salary?.amount
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      // Validate phone format if provided
      if (phone && !validatePhoneFormat(phone)) {
        return res.status(400).json({
          success: false,
          message:
            "Phone must be in +234XXXXXXXXXX format (e.g. +2348012345678)",
        });
      }

      // Next of kin: if either part is given, both are needed, and the phone must be valid
      if (nextOfKin && (nextOfKin.name || nextOfKin.phone)) {
        if (!nextOfKin.name?.trim() || !nextOfKin.phone?.trim()) {
          return res.status(400).json({
            success: false,
            message: "Next of kin needs both a name and a phone number",
          });
        }
        if (!validatePhoneFormat(nextOfKin.phone.trim())) {
          return res.status(400).json({
            success: false,
            message:
              "Next of kin phone must be in +234XXXXXXXXXX format (e.g. +2348012345678)",
          });
        }
      }

      // Start date cannot be in the future
      if (new Date(startDate) > new Date()) {
        return res.status(400).json({
          success: false,
          message: "Start date cannot be in the future",
        });
      }

      // Salary currency must match company base currency
      if (salary?.currency) {
        const company =
          await Company.findById(companyId).select("baseCurrency");

        if (company && salary.currency !== company.baseCurrency) {
          return res.status(400).json({
            success: false,
            message: `Salary currency (${salary.currency}) must match company base currency (${company.baseCurrency})`,
          });
        }
      }

      // Bank details validation
      const bankValidation = validateBankDetails(
        bankDetails,
        firstName,
        lastName,
      );

      if (bankValidation.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Bank details validation failed",
          errors: bankValidation.errors,
        });
      }

      // Check if user email already exists
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email already registered",
        });
      }

      // Generate temporary password
      const temporaryPassword =
        crypto.randomBytes(9).toString("base64url") + "Aa1!";

      // Create user account for employee
      const user = await User.create({
        email,
        password: temporaryPassword,
        firstName,
        lastName,
        phone,
        role: "employee",
        company: companyId,
        mustChangePassword: true,
      });

      // Create employee record
      const employee = await Employee.create({
        user: user._id,
        company: companyId,
        position,
        department,
        employmentType: employmentType || "full-time",
        startDate,
        salary: {
          amount: salary.amount,
          currency: salary.currency || "NGN",
          payFrequency: salary.payFrequency || "monthly",
        },
        bankDetails,
        taxInformation,
        manager,
        nextOfKin: nextOfKin?.name
          ? { name: nextOfKin.name.trim(), phone: nextOfKin.phone.trim() }
          : undefined,
      });

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "employee_created",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        details: {
          employeeId: employee.employeeId,
          name: `${firstName} ${lastName}`,
          position,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "medium",
      });

      // Send welcome email with temporary password
      try {
        await emailService.sendWelcomeEmail(
          {
            firstName: user.firstName,
            email: user.email,
          },
          temporaryPassword,
        );
      } catch (emailError) {
        // Don't block response if email fails
        console.error("Welcome email failed:", emailError.message);
      }

      return res.status(201).json({
        success: true,
        message: "Employee created successfully",

        ...(bankValidation.warnings.length > 0 && {
          warnings: bankValidation.warnings,
        }),

        // DEV ONLY: shows the temporary password when email isn't set up
        ...(process.env.NODE_ENV !== "production" && { temporaryPassword }),

        data: {
          employee,
          user: {
            id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
          },
        },
      });
    } catch (error) {
      console.error("Create employee error:", error);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create employee",
      });
    }
  }

  /**
   * Get all employees for a company
   * GET /api/employees
   */
  async getAllEmployees(req, res) {
    try {
      const companyId = req.user.company;

      const {
        page = 1,
        department,
        position,
        isActive,
        search,
        sortBy = "lastName",
        sortOrder = "asc",
      } = req.query;

      // Maximum pagination limit is 100
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const skip = (parseInt(page) - 1) * limit;

      // Initial match — only this company's employees, never deleted ones
      const matchStage = {
        company: companyId,
        isDeleted: { $ne: true },
      };

      if (department) {
        matchStage.department = department;
      }

      if (position) {
        matchStage.position = {
          $regex: position,
          $options: "i",
        };
      }

      if (isActive !== undefined) {
        matchStage.isActive = isActive === "true";
      }

      // Sort direction
      const sortDirection = sortOrder === "desc" ? -1 : 1;

      /**
       * Aggregation pipeline
       */
      const pipeline = [
        // Stage 1: Filter to this company
        {
          $match: matchStage,
        },

        // Stage 2: Join User document
        {
          $lookup: {
            from: "users",
            localField: "user",
            foreignField: "_id",
            as: "user",
            pipeline: [
              {
                $project: {
                  firstName: 1,
                  lastName: 1,
                  email: 1,
                  phone: 1,
                  role: 1,
                  isActive: 1,
                },
              },
            ],
          },
        },

        // Stage 3: Convert user array to object
        {
          $unwind: "$user",
        },

        // Stage 4: Join manager employee document
        {
          $lookup: {
            from: "employees",
            localField: "manager",
            foreignField: "_id",
            as: "manager",
          },
        },

        // Stage 5: Keep employees without managers
        {
          $unwind: {
            path: "$manager",
            preserveNullAndEmptyArrays: true,
          },
        },

        // Stage 6: Search filter
        ...(search
          ? [
              {
                $match: {
                  $or: [
                    {
                      "user.firstName": {
                        $regex: search,
                        $options: "i",
                      },
                    },
                    {
                      "user.lastName": {
                        $regex: search,
                        $options: "i",
                      },
                    },
                    {
                      "user.email": {
                        $regex: search,
                        $options: "i",
                      },
                    },
                    {
                      "user.phone": {
                        $regex: search,
                        $options: "i",
                      },
                    },
                    {
                      position: {
                        $regex: search,
                        $options: "i",
                      },
                    },
                    {
                      employeeId: {
                        $regex: search,
                        $options: "i",
                      },
                    },
                  ],
                },
              },
            ]
          : []),

        // Stage 7: Sort
        {
          $sort: {
            [`user.${sortBy}`]: sortDirection,
          },
        },

        // Stage 8: Pagination + total count
        {
          $facet: {
            data: [
              {
                $skip: skip,
              },
              {
                $limit: limit,
              },
            ],
            total: [
              {
                $count: "count",
              },
            ],
          },
        },
      ];

      const [result] = await Employee.aggregate(pipeline);

      const employees = result.data;
      const total = result.total[0]?.count || 0;

      return res.status(200).json({
        success: true,
        data: employees,
        pagination: {
          page: parseInt(page),
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error("Get employees error:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch employees",
      });
    }
  }

  /**
   * Get employee by ID
   * GET /api/employees/:id
   */
  async getEmployeeById(req, res) {
    try {
      const companyId = req.user.company;
      const { id } = req.params;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      })
        .populate(
          "user",
          "firstName lastName email phone role isActive lastLogin",
        )
        .populate("manager", "user employeeId position")
        .lean();

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      // Field-level access control
      const role = req.user.role;
      const isOwnProfile =
        employee.user._id.toString() === req.user.id.toString();

      // Employees can view their own profile
      if (role === "employee" && isOwnProfile) {
        return res.status(200).json({
          success: true,
          data: {
            employeeId: employee.employeeId,
            position: employee.position,
            department: employee.department,
            employmentType: employee.employmentType,
            startDate: employee.startDate,
            salary: employee.salary,
            bankDetails: employee.bankDetails,
            taxInformation: employee.taxInformation,
            nextOfKin: employee.nextOfKin,
            user: {
              firstName: employee.user.firstName,
              lastName: employee.user.lastName,
              email: employee.user.email,
              phone: employee.user.phone,
            },
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: employee,
      });
    } catch (error) {
      console.error("Get employee error:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch employee",
      });
    }
  }

  /**
   * Update employee
   * PUT /api/employees/:id
   */
  async updateEmployee(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const updates = req.body;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      const allowedUpdates = [
        "position",
        "department",
        "employmentType",
        "salary",
        "bankDetails",
        "taxInformation",
        "manager",
        "status",
        "nextOfKin",
      ];

      // Validate bank details when updating them
      if (updates.bankDetails) {
        const employeeUser = await User.findById(employee.user).select(
          "firstName lastName",
        );

        const bankValidation = validateBankDetails(
          updates.bankDetails,
          employeeUser?.firstName,
          employeeUser?.lastName,
        );

        if (bankValidation.errors.length > 0) {
          return res.status(400).json({
            success: false,
            message: "Bank details validation failed",
            errors: bankValidation.errors,
          });
        }

        req._bankWarnings = bankValidation.warnings;
      }

      const before = {
        ...employee.toObject(),
      };

      allowedUpdates.forEach((field) => {
        if (updates[field] !== undefined) {
          employee[field] = updates[field];
        }
      });

      await employee.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "employee_updated",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        changes: {
          before,
          after: employee.toObject(),
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "medium",
      });

      return res.status(200).json({
        success: true,
        message: "Employee updated successfully",

        ...(req._bankWarnings?.length > 0 && {
          warnings: req._bankWarnings,
        }),

        data: employee,
      });
    } catch (error) {
      console.error("Update employee error:", error);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to update employee",
      });
    }
  }

  /**
   * Employee updates their own profile
   * PATCH /api/employees/:id/profile
   *
   * Employees can update:
   * - Bank details
   * - Tax information
   */
  async updateOwnProfile(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;
      const updates = req.body;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      // Employee can only update their own profile
      if (employee.user.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "You can only update your own profile",
        });
      }

      const allowedFields = ["bankDetails", "taxInformation"];

      // Validate bank details
      if (updates.bankDetails) {
        const user = await User.findById(userId).select("firstName lastName");

        const bankValidation = validateBankDetails(
          updates.bankDetails,
          user.firstName,
          user.lastName,
        );

        if (bankValidation.errors.length > 0) {
          return res.status(400).json({
            success: false,
            message: "Bank details validation failed",
            errors: bankValidation.errors,
          });
        }

        req._bankWarnings = bankValidation.warnings;
      }

      allowedFields.forEach((field) => {
        if (updates[field] !== undefined) {
          employee[field] = updates[field];
        }
      });

      await employee.save();

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "employee_profile_updated",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        details: {
          updatedFields: Object.keys(updates),
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "low",
      });

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",

        ...(req._bankWarnings?.length > 0 && {
          warnings: req._bankWarnings,
        }),

        data: employee,
      });
    } catch (error) {
      console.error("Update own profile error:", error);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to update profile",
      });
    }
  }

  /**
   * Deactivate employee
   * PATCH /api/employees/:id/deactivate
   */
  async deactivateEmployee(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;

      const { terminationDate, terminationReason } = req.body;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      employee.isActive = false;
      employee.terminationDate = terminationDate || new Date();
      employee.terminationReason = terminationReason;
      employee.endDate = terminationDate || new Date();

      await employee.save();

      // Deactivate user account
      await User.findByIdAndUpdate(employee.user, {
        isActive: false,
      });

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "employee_deactivated",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        details: {
          employeeId: employee.employeeId,
          terminationDate,
          reason: terminationReason,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "high",
      });

      return res.status(200).json({
        success: true,
        message: "Employee deactivated successfully",
        data: employee,
      });
    } catch (error) {
      console.error("Deactivate employee error:", error);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to deactivate employee",
      });
    }
  }

  /**
   * Activate employee
   * PATCH /api/employees/:id/activate
   */
  async activateEmployee(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      employee.isActive = true;
      employee.terminationDate = null;
      employee.terminationReason = null;
      employee.endDate = null;

      await employee.save();

      // Activate user account
      await User.findByIdAndUpdate(employee.user, {
        isActive: true,
      });

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "employee_activated",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        details: {
          employeeId: employee.employeeId,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "medium",
      });

      return res.status(200).json({
        success: true,
        message: "Employee activated successfully",
        data: employee,
      });
    } catch (error) {
      console.error("Activate employee error:", error);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to activate employee",
      });
    }
  }

  /**
   * Change an employee's access role (founder only)
   * PATCH /api/employees/:id/role    Body: { role: "hr" | "admin" | "employee" }
   */
  async updateRole(req, res) {
    try {
      const companyId = req.user.company;
      const { id } = req.params;
      const { role } = req.body;

      const assignable = ["employee", "hr", "admin"];
      if (!assignable.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Role must be one of: ${assignable.join(", ")}`,
        });
      }

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      });
      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      if (employee.user.toString() === req.user.id.toString()) {
        return res.status(403).json({
          success: false,
          message: "You cannot change your own role",
        });
      }

      const target = await User.findOne({
        _id: employee.user,
        company: companyId,
      });
      if (!target) {
        return res.status(404).json({
          success: false,
          message: "User account not found",
        });
      }
      if (target.role === "founder") {
        return res.status(403).json({
          success: false,
          message: "The founder's role cannot be changed",
        });
      }

      const previousRole = target.role;
      target.role = role;
      await target.save();

      await Audit.log({
        company: companyId,
        user: req.user.id,
        action: "employee_role_changed",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        details: { previousRole, newRole: role },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "high",
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: `Role updated to ${role}`,
      });
    } catch (error) {
      console.error("Update role error:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to update role",
      });
    }
  }

  /**
   * Upload optional Government ID / Tax Form
   * POST /api/employees/:id/documents
   */
  async uploadDocuments(req, res) {
    try {
      const employee = await Employee.findOne({
        _id: req.params.id,
        company: req.user.company,
      });
      if (!employee) {
        return res
          .status(404)
          .json({ success: false, message: "Employee not found" });
      }

      const files = req.files || {};
      const keys = ["governmentId", "taxForm"].filter((k) => files[k]?.[0]);
      if (keys.length === 0) {
        return res
          .status(400)
          .json({ success: false, message: "No document was provided" });
      }

      const dir = path.join(
        process.cwd(),
        "uploads",
        "employees",
        String(req.user.company),
      );

      for (const key of keys) {
        // Replacing a document: delete the old file from disk first
        const old = employee.documents.find((d) => d.docType === key);
        if (old) {
          fs.promises.unlink(path.join(dir, old.storedName)).catch(() => {});
        }
        employee.documents = employee.documents.filter(
          (d) => d.docType !== key,
        );

        const f = files[key][0];
        employee.documents.push({
          docType: key,
          originalName: f.originalname,
          storedName: f.filename,
          mimeType: f.mimetype,
          size: f.size,
        });
      }

      await employee.save();
      res.status(200).json({ success: true, message: "Documents uploaded" });
    } catch (error) {
      console.error("Upload documents error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to upload documents" });
    }
  }

  /**
   * View one document (authenticated, never a public URL)
   * GET /api/employees/:id/documents/:docType
   */
  async downloadDocument(req, res) {
    try {
      const employee = await Employee.findOne({
        _id: req.params.id,
        company: req.user.company,
      });
      if (!employee) {
        return res
          .status(404)
          .json({ success: false, message: "Employee not found" });
      }

      // HR and above may open anyone's; an employee only their own
      const role = String(req.user.role).toLowerCase();
      const isStaff = ["founder", "admin", "hr"].includes(role);
      if (!isStaff && String(employee.user) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: "Not allowed" });
      }

      const doc = employee.documents.find(
        (d) => d.docType === req.params.docType,
      );
      if (!doc) {
        return res
          .status(404)
          .json({ success: false, message: "Document not found" });
      }

      const filePath = path.join(
        process.cwd(),
        "uploads",
        "employees",
        String(req.user.company),
        path.basename(doc.storedName), // basename blocks "../" tricks
      );
      res.type(doc.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${doc.originalName.replace(/"/g, "")}"`,
      );
      res.sendFile(filePath);
    } catch (error) {
      console.error("Download document error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch document" });
    }
  }

  /**
   * Delete employee (soft delete)
   * DELETE /api/employees/:id
   *
   * Blocked while the employee has an active loan.
   */
  async deleteEmployee(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
        isDeleted: { $ne: true },
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      // An employee with an unpaid loan cannot be deleted
      const activeLoan = await EmployeeLoan.findOne({
        company: companyId,
        employee: employee._id,
        status: "active",
      });
      if (activeLoan) {
        const owed = Number(
          activeLoan.outstandingBalance || 0,
        ).toLocaleString();
        return res.status(400).json({
          success: false,
          message: `This employee still owes ₦${owed} on an active loan. Settle it before deactivating.`,
        });
      }

      employee.isActive = false;

      // Don't delete someone whose salary is being paid right now
      const Payroll = (await import("../models/payrollModel.js")).default;
      const inFlight = await Payroll.exists({
        company: companyId,
        status: "processing",
        "payrollItems.employee": employee._id,
      });
      if (inFlight) {
        return res.status(400).json({
          success: false,
          message:
            "This employee is part of a payroll that is currently being processed. Wait for it to finish before deleting.",
        });
      }

      // Soft delete — hide from lists and deactivate
      employee.isActive = false;
      employee.isDeleted = true;
      employee.deletedAt = new Date();
      employee.terminationDate = new Date();
      employee.terminationReason = "Deleted by admin";

      await employee.save();

      // Deactivate user so they can no longer log in
      await User.findByIdAndUpdate(employee.user, {
        isActive: false,
      });

      // Remove from any open payroll so they cannot be paid
      let removedFromPayrolls = 0;
      try {
        removedFromPayrolls =
          await payrollService.removeEmployeeFromOpenPayrolls(
            employee._id,
            companyId,
            userId,
          );
      } catch (payrollError) {
        // Delete already succeeded; the approve/process guard still blocks payment
        console.error("Failed to clean payroll after delete:", payrollError);
      }

      // Log audit
      await Audit.log({
        company: companyId,
        user: userId,
        action: "employee_deleted",
        module: "employee",
        resourceType: "employee",
        resourceId: employee._id,
        details: {
          employeeId: employee.employeeId,
        },
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        status: "success",
        severity: "high",
      });

      return res.status(200).json({
        success: true,
        message: "Employee deleted successfully",
        removedFromPayrolls,
      });
    } catch (error) {
      console.error("Delete employee error:", error);

      return res.status(400).json({
        success: false,
        message: error.message || "Failed to delete employee",
      });
    }
  }

  /**
   * Get employee statistics
   * GET /api/employees/stats
   */
  async getEmployeeStats(req, res) {
    try {
      const companyId = req.user.company;

      const [
        totalEmployees,
        activeEmployees,
        byDepartment,
        byEmploymentType,
        recentHires,
      ] = await Promise.all([
        Employee.countDocuments({
          company: companyId,
          isDeleted: { $ne: true },
        }),

        Employee.countDocuments({
          company: companyId,
          isDeleted: { $ne: true },
          isActive: true,
        }),

        Employee.aggregate([
          {
            $match: {
              company: companyId,
              isDeleted: { $ne: true },
              isActive: true,
            },
          },
          {
            $group: {
              _id: "$department",
              count: {
                $sum: 1,
              },
            },
          },
          {
            $sort: {
              count: -1,
            },
          },
        ]),

        Employee.aggregate([
          {
            $match: {
              company: companyId,
              isDeleted: { $ne: true },
              isActive: true,
            },
          },
          {
            $group: {
              _id: "$employmentType",
              count: {
                $sum: 1,
              },
            },
          },
        ]),

        Employee.find({
          company: companyId,
          isDeleted: { $ne: true },
          isActive: true,
        })
          .sort({
            startDate: -1,
          })
          .limit(5)
          .populate("user", "firstName lastName email")
          .select("employeeId position startDate")
          .lean(),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          totalEmployees,
          activeEmployees,
          inactiveEmployees: totalEmployees - activeEmployees,

          byDepartment: byDepartment.map((department) => ({
            department: department._id || "Unassigned",
            count: department.count,
          })),

          byEmploymentType: byEmploymentType.map((type) => ({
            type: type._id || "Unspecified",
            count: type.count,
          })),

          recentHires,
        },
      });
    } catch (error) {
      console.error("Get employee stats error:", error);

      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch employee statistics",
      });
    }
  }

  /**
   * Get list of Nigerian banks from Flutterwave
   * GET /api/employees/banks
   */
  async getNigerianBanks(req, res) {
    try {
      const response = await axios.get(
        "https://api.flutterwave.com/v3/banks/NG",
        {
          headers: {
            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
          },
        },
      );

      if (!response.data || response.data.status !== "success") {
        throw new Error("Failed to fetch banks from Flutterwave");
      }

      // Return only what the frontend needs
      const banks = response.data.data.map((bank) => ({
        name: bank.name,
        code: bank.code,
      }));

      return res.status(200).json({
        success: true,
        data: banks,
      });
    } catch (error) {
      console.error("Get Nigerian banks error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch Nigerian banks",
      });
    }
  }
}

export default new EmployeeController();
