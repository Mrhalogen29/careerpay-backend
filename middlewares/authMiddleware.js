import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import Employee from "../models/employeeModel.js";
import RevokedToken from "../models/revokedToken.js";

/**
 * Verify JWT token and attach user to request
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in Authorization header
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. No token provided",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject the token if it was revoked (e.g. via logout) — per BRD VRF-005.
    // Without this check, a "logged out" token stays valid until its natural
    // expiry, which defeats the purpose of blacklisting it on logout.
    const isRevoked = await RevokedToken.findOne({ token });
    if (isRevoked) {
      return res.status(401).json({
        success: false,
        message: "Your session is no longer valid. Please login again",
      });
    }

    // Check if user still exists
    const user = await User.findById(decoded.id)
      .select("-password")
      .populate("company", "name email isActive isVerified");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "User account is deactivated",
      });
    }

    // Check if company is active
    if (!user.company.isActive) {
      return res.status(401).json({
        success: false,
        message: "Company account is suspended",
      });
    }

    // Check if user changed password after token was issued
    if (decoded.iat && user.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({
        success: false,
        message: "Password recently changed. Please login again",
      });
    }

    // Attach user to request
    req.user = {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      company: user.company._id,
      companyName: user.company.name,
      isVerified: user.company.isVerified,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
};

/**
 * Restrict access to specific roles
 * Usage: restrictTo('founder', 'admin')
 */
export const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    }
    next();
  };
};

/**
 * Check if user is founder or admin
 */
export const isFounderOrAdmin = (req, res, next) => {
  if (req.user.role !== "founder" && req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access restricted to founders and admins only",
    });
  }
  next();
};

/**
 * Check if user is HR or above
 */
export const isHROrAbove = (req, res, next) => {
  const allowedRoles = ["founder", "admin", "hr"];
  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Access restricted to HR, admins, and founders only",
    });
  }
  next();
};

/**
 * Verify employee owns the resource (for employee-specific routes)
 * Checks if the employeeId in params matches the logged-in user's employee record
 */
export const verifyEmployeeOwnership = async (req, res, next) => {
  try {
    // Route params use ":id" (see employeeRoutes.js), not ":employeeId" —
    // previously this always read undefined and blocked every employee
    // from viewing their own profile.
    const { id: employeeId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Founders, admins, and HR can access any employee data
    if (["founder", "admin", "hr"].includes(userRole)) {
      return next();
    }

    // For regular employees, check if they're accessing their own data
    const employee = await Employee.findOne({
      _id: employeeId,
      user: userId,
    });

    if (!employee) {
      return res.status(403).json({
        success: false,
        message: "You can only access your own data",
      });
    }

    next();
  } catch (error) {
    console.error("Employee ownership verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify access",
    });
  }
};

/**
 * blocks access to protected features until company email is verified
 */
export const requireVerified = (req, res, next) => {
  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message: "Please verify your email address to continue.",
    });
  }
  next();
};

/**
 * Optional authentication - doesn't fail if no token
 * Useful for routes that work differently for authenticated vs non-authenticated users
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");

    if (user && user.isActive) {
      req.user = {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        company: user.company,
      };
    }

    next();
  } catch (error) {
    // Don't fail - just continue without user
    next();
  }
};

/**
 * Attach employee record to request
 * Useful for routes that need employee information
 */
export const attachEmployee = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const companyId = req.user.company;

    const employee = await Employee.findOne({
      user: userId,
      company: companyId,
    }).select("_id employeeId position department salary");

    if (employee) {
      req.employee = employee;
    }

    next();
  } catch (error) {
    console.error("Attach employee error:", error);
    next(); // Don't fail - just continue without employee data
  }
};
