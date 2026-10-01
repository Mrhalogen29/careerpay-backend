import axios from "axios";

import Employee from "../models/employeeModel.js";
import User from "../models/userModel.js";
import Company from "../models/companyModel.js";
import Audit from "../models/auditModel.js";
import emailService from "../services/emailService.js";

/**
 * Validates bank details against BRD rules and custom validations.
 *
 * Warnings (non-blocking):
 * - Account name doesn't contain employee's first or last name
 */
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
      } = req.body;

      // Validate required fields
      if (
        !email ||
        !firstName ||
        !lastName ||
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
      const temporaryPassword = Math.random().toString(36).slice(-8) + "Aa1!";

      // Create user account for employee
      const user = await User.create({
        email,
        password: temporaryPassword,
        firstName,
        lastName,
        phone,
        role: "employee",
        company: companyId,
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

      // Initial match — only this company's employees
      const matchStage = {
        company: companyId,
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
      const isOwnProfile = employee.user._id.toString() === req.user.id;

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
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      // Employee can only update their own profile
      if (employee.user.toString() !== userId) {
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
   * Delete employee (soft delete)
   * DELETE /api/employees/:id
   */
  async deleteEmployee(req, res) {
    try {
      const companyId = req.user.company;
      const userId = req.user.id;
      const { id } = req.params;

      const employee = await Employee.findOne({
        _id: id,
        company: companyId,
      });

      if (!employee) {
        return res.status(404).json({
          success: false,
          message: "Employee not found",
        });
      }

      // Soft delete — deactivate employee
      employee.isActive = false;
      employee.terminationDate = new Date();
      employee.terminationReason = "Deleted by admin";

      await employee.save();

      // Deactivate user
      await User.findByIdAndUpdate(employee.user, {
        isActive: false,
      });

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
        }),

        Employee.countDocuments({
          company: companyId,
          isActive: true,
        }),

        Employee.aggregate([
          {
            $match: {
              company: companyId,
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
        message: error.message || "Failed to fetch Nigerian banks",
      });
    }
  }
}

export default new EmployeeController();
