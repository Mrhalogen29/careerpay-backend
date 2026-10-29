import jwt from "jsonwebtoken";
import authService from "../services/authService.js";
import {
  isValidEmail,
  isStrongPassword,
  isValidPhone,
} from "../middlewares/validator.js";
import subscriptionPurchaseService from "../services/subscriptionPurchaseService.js";

class AuthController {
  /**
   * Register new company and founder
   * POST /api/auth/register
   */

  async register(req, res) {
    try {
      const { company, user, claimCode } = req.body;

      // Validate required fields
      if (
        !company?.name ||
        !company?.email ||
        !company?.phone ||
        !company?.industry ||
        !company?.baseCurrency ||
        !user?.email ||
        !user?.password ||
        !user?.firstName ||
        !user?.lastName ||
        !user?.phone
      ) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields",
        });
      }

      // Validate company email ---
      if (!isValidEmail(company.email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid company email format",
        });
      }

      if (!isValidPhone(company.phone)) {
        return res.status(400).json({
          success: false,
          message: "Invalid company phone number",
        });
      }

      // Validate user email ---
      if (!isValidEmail(user.email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user email format",
        });
      }

      // Validate user password ---
      if (!isStrongPassword(user.password)) {
        return res.status(400).json({
          success: false,
          message:
            "Password must be at least 8 characters, contain 1 uppercase, 1 lowercase, 1 number, and 1 special character",
        });
      }

      if (!isValidPhone(user.phone)) {
        return res.status(400).json({
          success: false,
          message: "Invalid phone number",
        });
      }
      // Only a founder can register a company. Employees are added by their
      // founder from the Add Employees page.
      const requestedRole = String(user.role || "founder")
        .trim()
        .toLowerCase();
      if (requestedRole !== "founder") {
        return res.status(403).json({
          success: false,
          message:
            "Only a company founder can register a company. Ask your founder to add you as an employee.",
        });
      }

      // Sign-up requires a paid subscription. Check the code BEFORE creating
      // anything, so a bad code never leaves a half-created company behind.
      if (!claimCode || typeof claimCode !== "string") {
        return res.status(402).json({
          success: false,
          message:
            "A paid subscription is required before you can create an account.",
        });
      }
      await subscriptionPurchaseService.assertClaimable(claimCode.trim());

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("user-agent");

      const result = await authService.registerCompany(
        company,
        user,
        ipAddress,
        userAgent,
        claimCode.trim(),
      );

      res.status(201).json({
        success: true,
        message: "Company registered successfully",
        data: result,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Registration failed",
      });
    }
  }

  /**
   * Verify company email after registration
   * GET /api/auth/verify-email/:token
   */
  async verifyEmail(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Verification token is required",
        });
      }

      const result = await authService.verifyEmail(token);

      res.status(200).json({
        success: true,
        message: result.message,
        data: {
          onboardingCompleted: result.onboardingCompleted,
        },
      });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(error.statusCode || 400).json({
        success: false,
        message: error.message || "Email verification failed",
      });
    }
  }

  async resendVerification(req, res) {
    try {
      const companyId = req.user.company;

      const result = await authService.resendVerificationEmail(companyId);

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      console.error("Resend verification error:", error);
      res.status(error.statusCode || 400).json({
        success: false,
        message: error.message || "Failed to resend verification email",
      });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required",
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("user-agent");

      const result = await authService.login(
        email,
        password,
        ipAddress,
        userAgent,
      );

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: result,
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(error.statusCode || 401).json({
        success: false,
        message: error.message || "Login failed",
      });
    }
  }

  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: "Refresh token is required",
        });
      }

      const result = await authService.refreshAccessToken(refreshToken);

      res.status(200).json({
        success: true,
        message: "Token refreshed successfully",
        data: result,
      });
    } catch (error) {
      console.error("Token refresh error:", error);
      res.status(401).json({
        success: false,
        message: error.message || "Token refresh failed",
      });
    }
  }

  async logout(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer")
        ? authHeader.split(" ")[1]
        : null;
      const { refreshToken } = req.body || {};

      let userId;
      let companyId;

      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            ignoreExpiration: true,
          });
          userId = decoded.id;
          companyId = decoded.companyId;
        } catch (decodeError) {
          // Invalid signature or malformed token — nothing to revoke, not an error case.
        }
      }

      const ipAddress = req.ip || req.connection?.remoteAddress;
      const userAgent = req.get("user-agent");

      try {
        if (userId) {
          await authService.logout(
            userId,
            token,
            refreshToken,
            companyId,
            ipAddress,
            userAgent,
          );
        } else if (token) {
          await authService.revokeAccessToken(token, null, "logout");
        }
      } catch (innerError) {
        console.error(
          "Logout side-effect error (non-fatal):",
          innerError.message,
        );
      }

      res.status(200).json({
        success: true,
        message: "Logout successful",
      });
    } catch (error) {
      console.error("Logout error (returning success anyway):", error);
      res.status(200).json({
        success: true,
        message: "Logout successful",
      });
    }
  }

  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      if (!isValidEmail(email)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user email format",
        });
      }
      const result = await authService.requestPasswordReset(email);

      res.status(200).json({
        success: true,
        message: result.message,

        ...(process.env.NODE_ENV !== "production" && {
          resetToken: result.resetToken,
        }),
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(200).json({
        success: true,
        message: "If an account exists, a reset link has been sent",
      });
    }
  }

  async resetPassword(req, res) {
    try {
      const { resetToken, newPassword } = req.body;

      if (!resetToken || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Reset token and new password are required",
        });
      }

      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
          success: false,
          message:
            "Password must contain 1 uppercase, 1 lowercase, 1 number and special character",
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters long",
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("user-agent");

      const result = await authService.resetPassword(
        resetToken,
        newPassword,
        ipAddress,
        userAgent,
      );

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Password reset failed",
      });
    }
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword, refreshToken } = req.body;
      const userId = req.user.id;
      const companyId = req.user.company;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Current password and new password are required",
        });
      }

      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
          success: false,
          message:
            "Password must contain 1 uppercase, 1 lowercase, 1 number and 1 special character",
        });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 8 characters long",
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("user-agent");

      const result = await authService.changePassword(
        userId,
        companyId,
        currentPassword,
        newPassword,
        refreshToken,
        ipAddress,
        userAgent,
      );

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Password change failed",
      });
    }
  }

  async getCurrentUser(req, res) {
    try {
      const userId = req.user.id;
      const profile = await authService.getCurrentUser(userId);

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      console.error("Get current user error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch user profile",
      });
    }
  }

  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const companyId = req.user.company;
      const updates = req.body;

      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({
          success: false,
          message: "At least one field must be provided",
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("user-agent");

      const result = await authService.updateProfile(
        userId,
        companyId,
        updates,
        ipAddress,
        userAgent,
      );

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: result,
      });
    } catch (error) {
      console.error("Update profile error:", error);
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message || "Profile update failed",
      });
    }
  }

  async verifyToken(req, res) {
    try {
      const token = req.headers.authorization?.split(" ")[1];
      let expiresAt = null;

      if (token) {
        const decoded = jwt.decode(token);
        if (decoded?.exp) {
          expiresAt = new Date(decoded.exp * 1000).toISOString();
        }
      }

      res.status(200).json({
        success: true,
        message: "Token is valid",
        data: {
          userId: req.user.id,
          email: req.user.email,
          role: req.user.role,
          companyId: req.user.company,
        },
        expiresAt,
      });
    } catch (error) {
      console.error("Verify token error:", error);
      res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }
  }
}

export default new AuthController();
