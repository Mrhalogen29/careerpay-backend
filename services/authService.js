import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/userModel.js";
import Company from "../models/companyModel.js";
import Employee from "../models/employeeModel.js";
import Audit from "../models/auditModel.js";
import LoginAttempt from "../models/loginAttempt.js";
import RevokedToken from "../models/revokedToken.js";
import emailService from "./emailService.js";

class AuthService {
  // Generate JWT token
  generateToken(userId,companyId, role, email) {
    return jwt.sign({ id: userId,companyId, role, email }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    });
  }

  //   Generate refresh token
  generateRefreshToken(userId) {
    return jwt.sign(
      { id: userId, type: "refresh" },
      process.env.JWT_REFRESH_SECRET,
      {
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
      }
    );
  }

  //   Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error("Invalid or expired token");
    }
  }

  // Verify refresh token
  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      throw new Error("Invalid or Expired refresh token");
    }
  }

  async revokeAccessToken(token, userId, reason = "logout") {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return; // malformed — nothing to revoke

      await RevokedToken.create({
        token,
        userId,
        reason,
        expiresAt: new Date(decoded.exp * 1000), // TTL matches token's natural expiry
      });
    } catch (error) {
      // Never throw from here — revocation failure must not block logout
      console.error("Token revocation error (non-fatal):", error.message);
    }
  }

  //   Register new company and founder

async registerCompany(companyData, userData, ipAddress, userAgent) {

  const session = await Company.startSession();

  try {
    session.startTransaction();

    const existingCompanyEmail = await Company.findOne({ email: companyData.email }).session(session);
    if (existingCompanyEmail) throw new Error("Company email already registered");

    const existingCompanyPhone = await Company.findOne({ phone: companyData.phone }).session(session);
    if (existingCompanyPhone) throw new Error("Company phone already registered");

    const existingUserEmail = await User.findOne({ email: userData.email }).session(session);
    if (existingUserEmail) throw new Error("User email already registered");

    const existingUserPhone = await User.findOne({ phone: userData.phone }).session(session);
    if (existingUserPhone) throw new Error("User phone already registered");

    // Create company ---
    const [createdCompany] = await Company.create([{
      name: companyData.name,
      email: companyData.email,
      phone: companyData.phone,
      industry: companyData.industry,
      address: companyData.address,
      baseCurrency: companyData.baseCurrency || "NGN",
    }], { session });

    // Create founder user ---
    const [createdUser] = await User.create([{
      email: userData.email,
      password: userData.password,
      firstName: userData.firstName,
      lastName: userData.lastName,
      phone: userData.phone,
      role: "founder",
      company: createdCompany._id,
    }], { session });

    // Create employee record for founder ---
    const [createdEmployee] = await Employee.create([{
      user: createdUser._id,
      company: createdCompany._id,
      position: userData.position || "Founder",
      department: "Management",
      employmentType: "full-time",
      startDate: new Date(),
      salary: {
        amount: userData.salary || 0,
        currency: createdCompany.baseCurrency,
      },
    }], { session });

    // Commit transaction ---
    await session.commitTransaction();

    // Generate email verification otp ---
    // The raw otp goes in the email link, the hashed version is saved in the DB
    const verificationToken = crypto.randomInt(100000, 999999).toString();
    const hashedVerificationToken = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");

    // Save hashed otp and expiry on the company (24 hour window)
    await Company.findByIdAndUpdate(createdCompany._id, {
      emailVerificationToken: hashedVerificationToken,
      emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    // Send verification email ---
    // Don't block registration if email fails — log and continue
    try {
      await emailService.sendVerificationEmail(
        createdUser,
        createdCompany,
        verificationToken // raw otp goes to the user email
      );
    } catch (emailError) {
      console.error("Verification email failed (non-fatal):", emailError.message);
    }

    //  Log audit after successful transaction ---
  try {
    await Audit.log({
      company: createdCompany._id,
      user: createdUser._id,
      module: "auth",
      action: "company_created",
      resourceType: "company",
      resourceId: createdCompany._id,
      details: {
        companyName: createdCompany.name,
        founderEmail: createdUser.email,
      },
      ipAddress,
      userAgent,
      status: "success",
      severity: "medium",
    });
} catch(auditError) {
  console.error("Audit log creation failed:", auditError.message);
}


    // Return data and generate tokens ---
    const token = this.generateToken(createdUser._id,createdCompany._id, createdUser.role, createdUser.email);
    const refreshToken = this.generateRefreshToken(createdUser._id);

    return {
      user: {
        id: createdUser._id,
        email: createdUser.email,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        role: createdUser.role,
      },
      company: {
        id: createdCompany._id,
        name: createdCompany.name,
        email: createdCompany.email,
      },
      employee: {
        id: createdEmployee._id,
        employeeId: createdEmployee.employeeId,
      },
      token,
      refreshToken,
      emailVerificationSent: true,
    };
  } catch (error) {
    //. Abort transaction if something fails ---
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    //  End session ---
    session.endSession();
  }
}


  //   Login user
  async login(email, password, ipAddress, userAgent) {
      const now = Date.now();

      // Check IP attempts
      let ipRecord = await LoginAttempt.findOne({ ipAddress });
      if (ipRecord) {
        const timeDiff = now - ipRecord.windowStart;

        if (timeDiff <= 10 * 60 * 1000) {
          if (ipRecord.attempts >= 5) {
            const error = new Error("Too many attempts, try again in 10 minutes");
            error.statusCode = 429;
            throw error;
          }
        } else {
          ipRecord.attempts = 0;
          ipRecord.windowStart = now;
          ipRecord.expiresAt = new Date(now + 10 * 60 * 1000); // ✅ update expiresAt
          await ipRecord.save(); // ✅ persist reset immediately
        }
      } else {
        ipRecord = new LoginAttempt({
          ipAddress,
          attempts: 0,
          windowStart: now,
          expiresAt: new Date(now + 10 * 60 * 1000),
        });
      }
      // find user and include password + refreshTokens
      const user = await User.findOne({ email, isActive: true })
        .select("+password +refreshTokens +knownDevices")
        .populate("company", "name email phone industry address baseCurrency logo isActive");

      if (!user) {
        ipRecord.attempts += 1;
        await ipRecord.save();
        // log failed attempt
        await Audit.create({
          action: "user_login",
          module: "auth",
          details: { email, reason: "user_not_found" },
          ipAddress,
          userAgent,
          status: "failure",
          severity: "medium",
        }).catch(() => {}); // it should not throw if audit fails

        throw new Error("Invalid email or password");
      }

      if (user.lockUntil && user.lockUntil > Date.now()) {
        ipRecord.attempts += 1; // ✅ still count IP attempts on locked account probe
        await ipRecord.save();
        const error = new Error("Account locked due to too many failed attempts. Try again in 1 hour.");
        error.statusCode = 429;
        throw error;
      }

      //check if user is active
      if (!user.isActive) {
       const error = new Error(
        "Your account has been suspended."
       );
       error.statusCode = 403;
       throw error;
      }
      //   Check if company is active
      if (!user.company.isActive) {
       const error = new Error("Company account is suspended");
        error.statusCode = 403;
        throw error;
      }

      // Verify password
      const isPasswordvalid = await user.comparePassword(password);
      if (!isPasswordvalid) {
      // increment IP attempts
      ipRecord.attempts += 1;
      await ipRecord.save();

      // Account-level: 10 failed per 60 min → 1 hour lockout
      if (
        !user.loginAttemptsWindowStart ||
        Date.now() - user.loginAttemptsWindowStart > 60 * 60 * 1000
      ) {
        user.loginAttempts = 1;
        user.loginAttemptsWindowStart = Date.now();
      } else {
        user.loginAttempts += 1;
      }

      // Lock account after 10 attempts
      if (user.loginAttempts >= 10) {
        user.lockUntil = new Date(Date.now() + 60 * 60 * 1000);
        await emailService.sendSecurityAlertEmail(user, {
          reason: "Your account has been locked due to multiple failed login attempts",
          ipAddress
        });
      }
      await user.save();

      // log failed attempt
        await Audit.log({
          company: user.company._id,
          user: user._id,
          action: "user_login",
          module: "auth",
          details: { email, reason: "invalid_password" },
          ipAddress,
          userAgent,
          status: "failure",
          severity: "medium",
        });

        throw new Error("Invalid email or password");
      }

      // success - reset counters
      user.loginAttempts = 0;
      user.loginAttemptsWindowStart = undefined;
      user.lockUntil = undefined;
     await LoginAttempt.deleteOne({ ipAddress });

      // New device notification
      const isKnownDevice = user.knownDevices.some(
        (d) => d.userAgent === userAgent && d.ipAddress === ipAddress
      );
      if (!isKnownDevice) {
        user.knownDevices.push({ userAgent, ipAddress });
        if (user.knownDevices.length > 10) {
          user.knownDevices = user.knownDevices.slice(-10);
        }
        await emailService
        .sendNewDeviceNotificationEmail(user, { ipAddress, userAgent })
        .catch(() => {});
      }

        // Clean expired refresh tokens (good practice)
      user.refreshTokens = user.refreshTokens.filter(
          (t) => t.expiresAt > new Date()
      );

      // Optional: limit max sessions (e.g., 5 devices)
      if (user.refreshTokens.length >= 5) {
        user.refreshTokens.shift(); // remove oldest
      }
      
       //   generate tokens
      const token = this.generateToken(user._id,user.company._id, user.role, user.email);
      const refreshToken = this.generateRefreshToken(user._id);

    // Store refresh token in DB
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      createdAt: new Date(),
      ipAddress,
      userAgent,
    });

      //   update last login
      user.lastLogin = new Date();
      await user.save();

      // log successful login
      await Audit.log({
        company: user.company._id,
        user: user._id,
        action: "user_login",
        module: "auth",
        details: { email },
        ipAddress,
        userAgent,
        status: "success",
        severity: "low",
      }).catch(() => {});

      return {
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          lastLogin: user.lastLogin,
        },
        company: {
          id: user.company._id,
          name: user.company.name,
          email: user.company.email,
          phone: user.company.phone,
          industry: user.company.industry,
          address: user.company.address,
          baseCurrency: user.company.baseCurrency,
          logo: user.company.logo,
        },
        token,
        refreshToken,
      };
    
  }

  //   Refresh access token
  async refreshAccessToken(refreshToken) {
    try {
      const decoded = this.verifyRefreshToken(refreshToken);
      const user = await User.findById(decoded.id).select("role email company refreshTokens");
      if (!user) {
        throw new Error("User not found");
      }

       // Check if token exists in DB
      // user.refreshTokens = user.refreshTokens || [];
      const tokenIndex = user.refreshTokens.findIndex(
        (t) => t.token === refreshToken && t.expiresAt > new Date()
      );

      if (tokenIndex === -1) {
        throw new Error("Invalid refresh token");
      }

      // Remove old refresh token (rotation)
      user.refreshTokens.splice(tokenIndex, 1);

      // generate new tokens
      const newToken = this.generateToken(user._id,user.company, user.role, user.email);
      const newRefreshToken = this.generateRefreshToken(user._id)

      user.refreshTokens.push({
        token: newRefreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });

        // Limit max 5 active sessions
      if (user.refreshTokens.length > 5) {
        user.refreshTokens = user.refreshTokens.slice(-5); // keep latest 5
      }
      await user.save();

      return { token: newToken,
               refreshToken: newRefreshToken
      };
    } catch (error) {
      throw error;
    }
  }

  // logout user
  async logout(userId,token,refreshToken, companyId, ipAddress, userAgent) {
    try {
       // Blacklist the access token (BRS LGT-001)
      if (token) {
        await this.revokeAccessToken(token, userId, "logout");
      }
      const user = await User.findById(userId).select("refreshTokens");
      if (user) {
        // Remove only the specific refresh token being logged out
        if (refreshToken) {
          user.refreshTokens = user.refreshTokens.filter(
            (t) => t.token !== refreshToken
          );
        }
        await user.save();
      }

      // logout user
      await Audit.log({
        company: companyId,
        user: userId,
        action: "user_logout",
        module: "auth",
        ipAddress,
        userAgent,
        status: "success",
        severity: "low",
      });
      return { message: "logged out successfully" };
    } catch (error) {
      throw error;
    }
  }

  // request password reset
  async requestPasswordReset(email) {
      const user = await User.findOne({ email, isActive: true });

      if (!user) {
        return {
          message: "If email exists, password reset link has been sent",
        };
      }

    // Invalidate any existing reset token first
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

      // generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      user.passwordResetToken = hashedToken;
      user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      await user.save({validateBeforeSave: false });

      // TODO: send email with reset token
      try {
        await emailService.sendPasswordResetEmail(user, resetToken);
      } catch (emailError) {
        // Rollback token if email fails
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save({ validateBeforeSave: false });
        throw new Error("Failed to send reset email. Please try again.");
      }
      // For now, return the token (in production, only send via email)
      const response = {
        message: "If this email exists, a password reset link has been sent",
      };

        // Only expose raw token outside production (for testing on Postman)
      if (process.env.NODE_ENV !== "production") {
          response.resetToken = resetToken;
      }

      return response;
  }

  // Reset password
  async resetPassword(resetToken, newPassword, ipAddress, userAgent) {
      const hashedToken = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

      const user = await User.findOne({
        passwordResetToken: hashedToken,
      }).select('+password +passwordHistory');

      if (!user) {
        throw new Error("Invalid or expired reset token");
      }

      // Check expiry — return exact expiry time in error
      if (user.passwordResetExpires < Date.now()) {
      const expiredAt = user.passwordResetExpires.toISOString();

      // Log the expired attempt
      await Audit.log({
        company: user.company,
        user: user._id,
        action: "password_reset_expired_token",
        module: "auth",
        details: { expiredAt },
        ipAddress,
        userAgent,
        status: "failure",
        severity: "low",
      }).catch(() => {});

      const error = new Error(
        `This password reset link expired on ${user.passwordResetExpires.toLocaleString()}. Please request a new one`
      );
      error.statusCode = 400;
      error.expiredAt = expiredAt;
      error.canRequestNew = true;
      throw error;
    }

      const isSameAsOld = await user.comparePassword(newPassword);
      if (isSameAsOld) {
        throw new Error(
          "New password cannot be the same as the current password"
        );
      }

     // Not in last 3 passwords
    const isInHistory = await user.isPasswordInHistory(newPassword);
    if (isInHistory) {
      throw new Error(
        "This password was used recently. Choose a different one"
      );
    }

      if (newPassword.length < 8) {
       throw new Error("Password must be at least 8 characters");
      }

      // Save current password to history BEFORE overwriting it
      user.addToPasswordHistory(user.password);
      user.password = newPassword;
      user.passwordChangedAt = new Date();

      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.refreshTokens = [];

      // Unlock account after successful password reset
      user.loginAttempts = 0;
      user.loginAttemptsWindowStart = undefined;
      user.lockUntil = undefined;
      await user.save();

      await emailService
      .sendPasswordResetConfirmationEmail(user, { ipAddress })
      .catch(() => {});

      // log password change
      await Audit.log({
        company: user.company,
        user: user._id,
        action: "password_reset",
        module: "auth",
        ipAddress,
        userAgent,
        status: "success",
        severity: "high",
      });

      return { message: "Password reset successful. You can now login" };

  }

  // change password (when logged in)
  async changePassword(
    userId,
    companyId,
    currentPassword,
    newPassword,
    currentRefreshToken,
    ipAddress,
    userAgent
  ) {
    try {
      const user = await User.findById(userId).select("+password +passwordHistory refreshTokens email firstName lastName");

      if (!user) {
        throw new Error("User not found");
      }

      // Verify current password
      const isPasswordvalid = await user.comparePassword(currentPassword);
      if (!isPasswordvalid) {
        throw new Error("Current password is incorrect");
      }

      // ❌ Prevent using same password again
      const isSameAsOld = await user.comparePassword(newPassword);
       if (isSameAsOld) {
          throw new Error(
           "New password cannot be the same as the current password"
        )
      }

    // Not in last 3 passwords
    const isInHistory = await user.isPasswordInHistory(newPassword);
    if (isInHistory) {
      throw new Error(
        "This password was used recently. Choose a different one"
      );
    }

      user.addToPasswordHistory(user.password);
      user.password = newPassword;
      user.passwordChangedAt = new Date();

    // Keep only the current session, log out all others
    if (currentRefreshToken) {
      user.refreshTokens = user.refreshTokens.filter(
        (t) => t.token === currentRefreshToken && t.expiresAt > new Date()
      );
    } else {
      user.refreshTokens = [];
    }
      await user.save();

      // BRS CHG-010: Confirmation email
      await emailService
      .sendPasswordChangeConfirmationEmail(user, { ipAddress, userAgent })
      .catch(() => {});

      // log password change
      await Audit.log({
        company: companyId,
        user: userId,
        action: "password_change",
        module: "auth",
        ipAddress,
        userAgent,
        status: "success",
        severity: "high",
      });

      return { message: "Password changed successfully" };
    } catch (error) {
      throw error;
    }
  }

   // Verify company email
  async verifyEmail(token) {
    // Hash the raw token from the URL to compare against what's stored in DB
    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
 
    // Find company with this token — must not be expired
    // Note: emailVerificationToken has select: false so we must explicitly request it
    const company = await Company.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: new Date() }, // token must still be valid
    }).select("+emailVerificationToken +emailVerificationExpires");
 
    if (!company) {
      const error = new Error(
        "Verification OTP is invalid or has expired. Please request a new one."
      );
      error.statusCode = 400;
      throw error;
    }

    company.isVerified = true
 
    // Check all required onboarding fields to decide if onboarding is complete
    // A company is fully onboarded when all five conditions are met
    const onboardingCompleted =
      !!company.baseCurrency &&
      !!company.payrollSettings?.payFrequency &&
      !!company.bankDetails?.accountNumber &&
      !!company.isVerified &&
      !!company.address?.street &&  
      !!company.address?.city &&    
      !!company.address?.state ;
 
    // Update company — mark verified, check onboarding, clear token fields
    company.onboardingCompleted = onboardingCompleted;
    company.emailVerificationToken = undefined;
    company.emailVerificationExpires = undefined;
    await company.save();
 
    return {
      message: "Email verified successfully. You can now use your account.",
      onboardingCompleted,
    };
  }

  // Resend verification email
  async resendVerificationEmail(companyId) {
    const company = await Company.findById(companyId).select(
     "+emailVerificationToken +emailVerificationExpires"
    );

    if (!company) {
     throw new Error("Company not found");
    }

    // If already verified, no need to resend
    if (company.isVerified) {
      const error = new Error("This account is already verified");
      error.statusCode = 400;
      throw error;
    }

    // Find the founder user to send the email to
    const founder = await User.findOne({
      company: companyId,
      role: "founder",
    }).select("email firstName");

    if (!founder) {
      throw new Error("Founder account not found");
    }

    // Generate a fresh otp — same pattern as registration
    const verificationToken = crypto.randomInt(100000, 999999).toString();
    const hashedVerificationToken = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");

    // Save new token and reset the 24 hour window
    company.emailVerificationToken = hashedVerificationToken;
    company.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await company.save();

    // Send the email — don't block if it fails
    try {
      await emailService.sendVerificationEmail(
        founder,
        company,
        verificationToken
      );
    } catch (emailError) {
      // Rollback token if email fails — same pattern as forgotPassword
      company.emailVerificationToken = undefined;
      company.emailVerificationExpires = undefined;
      await company.save();
      throw new Error("Failed to send verification email. Please try again.");
    }

    return {
      message: "Verification email sent. Please check your inbox.",
    };
  }
 

  // get current user profile
  async getCurrentUser(userId) {
    try {
      const user = await User.findById(userId)
        .populate("company", "name email phone industry address logo baseCurrency")
        .lean();

      if (!user) {
        const error = new Error("User profile not found");
        error.statusCode = 404;
        throw error;
      }

      const employee = await Employee.findOne({ user: userId })
        .select("employeeId position department employmentType startDate salary")
        .lean();
      return { ...user, employee };
    } catch (error) {
      throw error;
    }
  }

  //Update Profile
  async updateProfile(userId, companyId, updates, ipAddress, userAgent) {
    // BRS EDT-010: Reject read-only fields immediately
    const readOnlyFields = [
      "email", "password", "role", "company",
      "_id", "id", "isActive", "createdAt", "lastLogin",
    ];

    const attemptedReadOnly = Object.keys(updates).filter((key) =>
      readOnlyFields.includes(key)
    );
    if (attemptedReadOnly.length > 0) {
      const error = new Error(
        `Field '${attemptedReadOnly[0]}' cannot be edited`
      );
      error.statusCode = 400;
      throw error;
    }

    // BRS EDT-004: At least one valid field must be provided
    const allowedFields = ["firstName", "lastName", "phone", "profilePhoto"];
    const providedFields = Object.keys(updates).filter((key) =>
      allowedFields.includes(key)
    );
    if (providedFields.length === 0) {
      const error = new Error("At least one field must be provided");
      error.statusCode = 400;
      throw error;
    }

    const validatedUpdates = {};

    // ── First Name (EDT-007) ──────────────────────────────────────────────
    if (updates.firstName !== undefined) {
      const name = updates.firstName.trim();
      if (name.length < 2 || name.length > 50) {
        throw new Error("First name must be between 2 and 50 characters");
      }
      if (!/^[a-zA-Z\s'\-]+$/.test(name)) {
        throw new Error(
          "Name can only contain letters, spaces, hyphens, and apostrophes"
        );
      }
      validatedUpdates.firstName = name;
    }

    // ── Last Name (EDT-007) ───────────────────────────────────────────────
    if (updates.lastName !== undefined) {
      const name = updates.lastName.trim();
      if (name.length < 2 || name.length > 50) {
        throw new Error("Last name must be between 2 and 50 characters");
      }
      if (!/^[a-zA-Z\s'\-]+$/.test(name)) {
        throw new Error(
          "Name can only contain letters, spaces, hyphens, and apostrophes"
        );
      }
      validatedUpdates.lastName = name;
    }

    // ── Phone (EDT-006) ───────────────────────────────────────────────────
    if (updates.phone !== undefined) {
      const phone = updates.phone.trim();
      if (!/^\+234[0-9]{10}$/.test(phone)) {
        const error = new Error(
          "Please enter a valid Nigerian phone number (+234XXXXXXXXXX)"
        );
        error.statusCode = 400;
        throw error;
      }

      // BRS EDT-005: Phone must be unique across all users
      const existingPhone = await User.findOne({ phone, _id: { $ne: userId } });
      if (existingPhone) {
        const error = new Error("This phone number is already registered");
        error.statusCode = 400;
        throw error;
      }
      validatedUpdates.phone = phone;
    }

    // ── Profile Photo (EDT-009) ───────────────────────────────────────────
    if (updates.profilePhoto !== undefined) {
      const isUrl = /^https?:\/\/.+/.test(updates.profilePhoto);
      const isBase64 = /^data:image\/(jpeg|png|gif);base64,/.test(
        updates.profilePhoto
      );

      if (!isUrl && !isBase64) {
        throw new Error("Profile photo must be a valid URL or base64 image");
      }

      if (isBase64) {
        const base64Data = updates.profilePhoto.split(",")[1] || "";
        const sizeInBytes = Math.ceil((base64Data.length * 3) / 4);
        const sizeInMB = sizeInBytes / (1024 * 1024);
        if (sizeInMB > 5) {
          throw new Error("Profile photo must be less than 5MB");
        }
      }
      validatedUpdates.profilePhoto = updates.profilePhoto;
    }

    // Fetch current values for audit diff
    const currentUser = await User.findById(userId).select(
      "firstName lastName phone profilePhoto"
    );
    if (!currentUser) throw new Error("User not found");

    // BRS EDT-008: Build change record
    const changes = {};
    for (const [key, newVal] of Object.entries(validatedUpdates)) {
      changes[key] = { from: currentUser[key], to: newVal };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: validatedUpdates },
      { new: true, runValidators: true }
    ).select(
      "-password -refreshTokens -passwordResetToken -passwordHistory -loginAttempts -lockUntil -knownDevices"
    );

    await Audit.log({
      company: companyId,
      user: userId,
      action: "user_profile_updated",
      module: "auth",
      details: { changes },
      ipAddress,
      userAgent,
      status: "success",
      severity: "low",
    }).catch(() => {});

    return {
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        phone: updatedUser.phone,
        profilePhoto: updatedUser.profilePhoto,
        role: updatedUser.role,
        isActive: updatedUser.isActive,
        lastLogin: updatedUser.lastLogin,
      },
    };
  }
}

export default new AuthService();
