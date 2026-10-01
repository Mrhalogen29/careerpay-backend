import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { BrevoClient } = require("@getbrevo/brevo");

class EmailService {
  constructor() {
    this.client = new BrevoClient({
      apiKey: process.env.BREVO_API_KEY,
    });
    console.info("Email service ready");
  }

  // ─── Security Alert ──────────────────────────────────────────────────────────

  /**
   * Send security alert email (login lock / suspicious activity)
   * Called when account is locked after too many failed attempts
   */
  async sendSecurityAlertEmail(user, details) {
    const subject = "⚠️ Security Alert - Account Protection Notice";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #DC2626; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .alert { background: #FEE2E2; padding: 15px; border-left: 4px solid #DC2626; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Security Alert</h1>
            </div>
            <div class="content">
              <p>Hi ${user.firstName},</p>
              <div class="alert">
                <p><strong>Reason:</strong> ${details.reason}</p>
                <p><strong>IP Address:</strong> ${details.ipAddress}</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              </div>
              <p>If this was not you, we strongly recommend resetting your password immediately.</p>
              <a href="${process.env.APP_URL}/forgot-password" class="button">Reset Password</a>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  // ─── Email Verification ──────────────────────────────────────────────────────

/**
 * Send email verification link after company registration
 * Called in authService.registerCompany() after account is created
 * Token expires in 24 hours
 */
async sendVerificationEmail(user, company, verificationToken) {
  const subject = "✅ Verify Your CareerPay Account";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .otp { font-size: 48px; font-weight: bold; color: #4F46E5; text-align: center; letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
          .warning { background: #FEF3C7; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to CareerPay!</h1>
          </div>
          <div class="content">
            <p>Hi ${user.firstName},</p>
            <p>Thank you for registering <strong>${company.name}</strong> on CareerPay.</p>
            <p>Enter the code below to verify your email address:</p>
            <div class="otp">${verificationToken}</div>
            <div class="warning">
              <p><strong>Important:</strong></p>
              <ul>
                <li>This code expires in <strong>24 hours</strong></li>
                <li>Never share this code with anyone</li>
                <li>If you did not register on CareerPay, ignore this email</li>
              </ul>
            </div>
          </div>
          <div class="footer">
            <p>Need help? <a href="mailto:support@careerpay.ng">Contact support</a></p>
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return await this.sendEmail(user.email, subject, html);
}

  // ─── New Device Notification ─────────────────────────────────────────────────

  /**
   * NEW — BRS A.5: Notify user when login detected from an unrecognized device
   * Called during login when device is not in user's knownDevices list
   */
  async sendNewDeviceNotificationEmail(user, { ipAddress, userAgent }) {
    const subject = "🔐 New Device Login Detected - CareerPay";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #F59E0B; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .device-info { background: white; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0; border-radius: 4px; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            .button-danger { display: inline-block; padding: 12px 24px; background: #DC2626; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
            .button-safe { display: inline-block; padding: 12px 24px; background: #10B981; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 New Device Login</h1>
            </div>
            <div class="content">
              <p>Hi ${user.firstName},</p>
              <p>We detected a login to your CareerPay account from a device we don't recognize.</p>

              <div class="device-info">
                <h3>Login Details:</h3>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>IP Address:</strong> ${ipAddress}</p>
                <p><strong>Device:</strong> ${userAgent || "Unknown device"}</p>
              </div>

              <p>If this was you, no action is needed — this device has now been recognized.</p>
              <p>If this was <strong>not you</strong>, secure your account immediately:</p>

              <a href="${process.env.APP_URL}/forgot-password" class="button-danger">
                Secure My Account
              </a>
            </div>
            <div class="footer">
              <p>If you did not initiate this login, please reset your password immediately.</p>
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  // ─── Password Reset Confirmation ─────────────────────────────────────────────

  /**
   * NEW — BRS AC3-001: Confirmation email after a successful password reset
   * Called in authService.resetPassword() after password is updated
   */
  async sendPasswordResetConfirmationEmail(user, { ipAddress }) {
    const subject = "✅ Your Password Has Been Reset - CareerPay";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #10B981; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .info { background: white; padding: 15px; border-left: 4px solid #10B981; margin: 20px 0; border-radius: 4px; }
            .warning { background: #FEF3C7; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .button-danger { display: inline-block; padding: 12px 24px; background: #DC2626; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ Password Reset Successful</h1>
            </div>
            <div class="content">
              <p>Hi ${user.firstName},</p>
              <p>Your CareerPay password has been successfully reset. You can now log in with your new password.</p>

              <div class="info">
                <h3>Reset Details:</h3>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>IP Address:</strong> ${ipAddress}</p>
              </div>

              <div class="warning">
                <p><strong>Didn't reset your password?</strong></p>
                <p>If you did not request this change, your account may be compromised. Secure it immediately.</p>
              </div>

              <a href="${process.env.APP_URL}/login" class="button">Log In Now</a>
              <br />
              <a href="${process.env.APP_URL}/forgot-password" class="button-danger">
                This Wasn't Me — Secure My Account
              </a>
            </div>
            <div class="footer">
              <p>Need help? Contact us at <a href="mailto:support@careerpay.ng">support@careerpay.ng</a></p>
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  // ─── Password Change Confirmation ────────────────────────────────────────────

  /**
   * NEW — BRS CHG-010: Confirmation email after a logged-in user changes their password
   * Called in authService.changePassword() after password is updated
   * Includes "This wasn't me" link as specified in BRS security requirements
   */
  async sendPasswordChangeConfirmationEmail(user, { ipAddress, userAgent }) {
    const subject = "🔑 Your Password Has Been Changed - CareerPay";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .info { background: white; padding: 15px; border-left: 4px solid #4F46E5; margin: 20px 0; border-radius: 4px; }
            .warning { background: #FEF3C7; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
            .button-danger { display: inline-block; padding: 12px 24px; background: #DC2626; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔑 Password Changed</h1>
            </div>
            <div class="content">
              <p>Hi ${user.firstName},</p>
              <p>Your CareerPay account password was successfully changed.</p>

              <div class="info">
                <h3>Change Details:</h3>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>IP Address:</strong> ${ipAddress}</p>
                <p><strong>Device:</strong> ${userAgent || "Unknown device"}</p>
              </div>

              <p>For your security, all other active sessions have been logged out. Only the device you used to change your password remains logged in.</p>

              <div class="warning">
                <p><strong>Didn't make this change?</strong></p>
                <p>If you did not change your password, your account may be compromised. Act immediately.</p>
              </div>

              <a href="${process.env.APP_URL}/login" class="button">View My Account</a>
              <a href="${process.env.APP_URL}/forgot-password" class="button-danger">
                This Wasn't Me
              </a>
            </div>
            <div class="footer">
              <p>Need help? Contact us at <a href="mailto:support@careerpay.ng">support@careerpay.ng</a></p>
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  // ─── Password Reset Request ──────────────────────────────────────────────────

  /**
   * Send password reset link email
   * BRS FGT-009: Must include reset link, expiry time, security warning, support link
   */
  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
    const subject = "Password Reset Request - CareerPay";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .warning { background: #FEF3C7; padding: 15px; border-left: 4px solid #F59E0B; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset Request</h1>
            </div>
            <div class="content">
              <p>Hi ${user.firstName},</p>
              <p>We received a request to reset your password. Click the button below to reset it:</p>

              <a href="${resetUrl}" class="button">Reset Password</a>

              <p>Or copy and paste this link in your browser:</p>
              <p style="word-break: break-all; color: #4F46E5;">${resetUrl}</p>

              <div class="warning">
                <p><strong>Security Notice:</strong></p>
                <ul>
                  <li>This link will expire in <strong>15 minutes</strong></li>
                  <li>If you didn't request this, ignore this email — your password will not change</li>
                  <li>Never share this link with anyone</li>
                </ul>
              </div>

              <p>Need help? <a href="mailto:support@careerpay.ng">Contact support</a></p>
            </div>
            <div class="footer">
              <p>Sent from <a href="mailto:noreply@careerpay.ng">noreply@careerpay.ng</a></p>
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(user.email, subject, html);
  }

  // ─── Welcome Email ───────────────────────────────────────────────────────────

  /**
   * Send welcome email to new employee
   */
  async sendWelcomeEmail(employee, temporaryPassword) {
    const subject = `Welcome to ${process.env.APP_NAME || "CareerPay"}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .credentials { background: white; padding: 15px; border-left: 4px solid #4F46E5; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to ${process.env.APP_NAME || "CareerPay"}!</h1>
            </div>
            <div class="content">
              <p>Hi ${employee.firstName},</p>
              <p>Welcome to the team! Your employee account has been created.</p>
              <div class="credentials">
                <h3>Your Login Credentials:</h3>
                <p><strong>Email:</strong> ${employee.email}</p>
                <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>
              </div>
              <p><strong>Important:</strong> Please change your password after your first login for security.</p>
              <a href="${process.env.APP_URL}/login" class="button">Login to Your Account</a>
              <p>If you have any questions, please contact HR.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(employee.email, subject, html);
  }

  // ─── Payslip Email ───────────────────────────────────────────────────────────

  /**
   * Send payslip email to employee
   */
  async sendPayslipEmail(employee, payslip,currency, pdfAttachment = null) {
    const subject = `Payslip for ${this.getMonthName(payslip.payrollPeriod.month)} ${payslip.payrollPeriod.year}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .summary { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .amount { font-size: 32px; color: #4F46E5; font-weight: bold; }
            .button { display: inline-block; padding: 12px 24px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Your Payslip is Ready</h1>
            </div>
            <div class="content">
              <p>Hi ${employee.firstName},</p>
              <p>Your salary for ${this.getMonthName(payslip.payrollPeriod.month)} ${payslip.payrollPeriod.year} has been processed.</p>
              <div class="summary">
                <h2>Payment Summary</h2>
                <p><strong>Gross Salary:</strong> ${this.formatCurrency(payslip.grossSalary,currency)}</p>
                <p><strong>Total Deductions:</strong> ${this.formatCurrency(payslip.deductions.tax + payslip.deductions.pension + payslip.deductions.nhf, currency)}</p>
                <p><strong>Net Pay:</strong></p>
                <p class="amount">${this.formatCurrency(payslip.netSalary, currency)}</p>
              </div>
              <a href="${process.env.APP_URL}/payslips" class="button">View Full Payslip</a>
              <p>Your payslip has been attached to this email as a PDF.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(employee.email, subject, html);
  }

  // ─── Vesting Milestone ───────────────────────────────────────────────────────

  /**
   * Send vesting milestone email
   */
  async sendVestingMilestoneEmail(employee, vestingDetails) {
    const subject = `🎉 Shares Vested - ${vestingDetails.sharesVested} shares`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #10B981; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .highlight { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center; }
            .shares { font-size: 42px; color: #10B981; font-weight: bold; }
            .button { display: inline-block; padding: 12px 24px; background: #10B981; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .progress { background: #E5E7EB; height: 20px; border-radius: 10px; margin: 20px 0; }
            .progress-bar { background: #10B981; height: 100%; border-radius: 10px; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Congratulations!</h1>
              <p>Your Shares Have Vested</p>
            </div>
            <div class="content">
              <p>Hi ${employee.firstName},</p>
              <p>Great news! More of your equity has vested.</p>
              <div class="highlight">
                <p>Shares Vested Today:</p>
                <p class="shares">${vestingDetails.sharesVested.toFixed(2)}</p>
              </div>
              <h3>Your Equity Summary:</h3>
              <p><strong>Total Granted:</strong> ${vestingDetails.totalShares.toFixed(2)} shares</p>
              <p><strong>Total Vested:</strong> ${vestingDetails.totalVested.toFixed(2)} shares</p>
              <p><strong>Unvested:</strong> ${vestingDetails.totalUnvested.toFixed(2)} shares</p>
              <div class="progress">
                <div class="progress-bar" style="width: ${vestingDetails.vestingProgress}%"></div>
              </div>
              <p style="text-align: center;">${vestingDetails.vestingProgress.toFixed(1)}% Vested</p>
              ${vestingDetails.nextVestingDate ? `<p><strong>Next Vesting Date:</strong> ${new Date(vestingDetails.nextVestingDate).toLocaleDateString()}</p>` : ""}
              <a href="${process.env.APP_URL}/equity" class="button">View Your Equity</a>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(employee.email, subject, html);
  }

  // ─── Financing Approval ──────────────────────────────────────────────────────

  /**
   * Send financing approval email
   */
  async sendFinancingApprovalEmail(company, financing) {
    const subject = `Financing Application Approved - ${this.formatCurrency(financing.approvedAmount, financing.currency)}`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #10B981; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; padding: 12px 24px; background: #10B981; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✓ Financing Approved!</h1>
            </div>
            <div class="content">
              <p>Good news! Your financing application has been approved.</p>
              <div class="details">
                <h3>Loan Details:</h3>
                <p><strong>Approved Amount:</strong> ${this.formatCurrency(financing.approvedAmount, financing.currency)}</p>
                <p><strong>Interest Rate:</strong> ${financing.interestRate}%</p>
                <p><strong>Repayment Term:</strong> ${financing.repaymentTermDays} months</p>
                <p><strong>Total Repayment:</strong> ${this.formatCurrency(financing.totalRepaymentAmount, financing.currency)}</p>
              </div>
              <p>Funds will be disbursed within 24-48 hours.</p>
              <a href="${process.env.APP_URL}/financing" class="button">View Details</a>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(company.email, subject, html);
  }

  // ─── Repayment Reminder ──────────────────────────────────────────────────────

  /**
   * Send repayment reminder email
   */
  async sendRepaymentReminderEmail(company, repayment) {
    const subject = `Payment Reminder - ${this.formatCurrency(repayment.amount, repayment.currency)} Due`;

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #F59E0B; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .button { display: inline-block; padding: 12px 24px; background: #F59E0B; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Payment Reminder</h1>
            </div>
            <div class="content">
              <p>This is a reminder that you have an upcoming loan repayment due.</p>
              <div class="details">
                <h3>Payment Details:</h3>
                <p><strong>Amount Due:</strong> ${this.formatCurrency(repayment.amount, repayment.currency)}</p>
                <p><strong>Due Date:</strong> ${new Date(repayment.dueDate).toLocaleDateString()}</p>
              </div>
              <a href="${process.env.APP_URL}/financing" class="button">Make Payment</a>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "CareerPay"}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    return await this.sendEmail(company.email, subject, html);
  }

  // ─── Core Send Helper ────────────────────────────────────────────────────────

  /**
   * Send email helper — used by all methods above
   */
async sendEmail(to, subject, htmlContent) {
    try {
      const response = await this.client.transactionalEmails.sendTransacEmail({
        sender: {
          name: process.env.APP_NAME || "CareerPay",
          email: process.env.SMTP_FROM || "noreply@careerpay.ng",
        },
        to: [{ email: to }],
        subject,
        htmlContent,
      });

      console.log("Email sent:", response.messageId);
      return { success: true, messageId: response.messageId };
    } catch (error) {
      console.error("Email sending failed:", error);
      return { success: false, error: error.message };
    }
  }


  // ─── Helpers ─────────────────────────────────────────────────────────────────

  formatCurrency(amount, currency = "NGN") {
    const symbols = { NGN: "₦", USD: "$" };
    return `${symbols[currency] || currency} ${amount.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  getMonthName(month) {
    const months = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    return months[month - 1];
  }

  stripHtml(html) {
    return html.replace(/<[^>]*>/g, "");
  }
}

export default new EmailService();