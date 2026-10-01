# CareerPay Backend

A comprehensive Node.js/Express backend API for the CareerPay application, designed to handle career-related financial services, HR management, payroll processing, equity management, and financing services.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [Database Models](#database-models)
- [Services](#services)
- [Middlewares](#middlewares)
- [Security Features](#security-features)
- [Deployment](#deployment)
- [Scripts](#scripts)

## Overview

CareerPay Backend is a full-featured HR and financial management system that provides:

- Company and user authentication with role-based access control
- Employee management with comprehensive profiles
- Automated payroll processing with Nigerian tax calculations
- Equity/ESOP management with vesting schedules
- Payroll financing applications and management
- Comprehensive audit logging and activity tracking
- Dashboard analytics for different user roles

The system is built with Express.js, MongoDB, and follows RESTful API principles with proper authentication, validation, and error handling.

## Features

### Authentication & Authorization
- JWT-based authentication with access and refresh tokens
- Role-based access control (Founder, Admin, HR, Employee)
- Password reset and change functionality
- Company registration and onboarding
- User session management

### Employee Management
- Create, update, and manage employee records
- Employee ID auto-generation
- Department and position tracking
- Employment type management (full-time, part-time, contract, intern)
- Employee activation/deactivation
- Manager hierarchy support
- Employee statistics and analytics

### Payroll Management
- Automated payroll calculation with Nigerian tax compliance
- PAYE tax calculation with progressive tax bands
- Pension contributions (employee 8%, employer 10%)
- National Housing Fund (NHF) calculation
- Employer statutory contributions (ITF, NSITF)
- Payroll approval workflow
- Payslip generation
- Payroll export functionality
- Integration with financing for payroll funding

### Equity Management
- Equity grant creation and management
- Multiple grant types (stock options, RSU, restricted stock, phantom stock)
- Automated vesting schedule generation
- Vesting processing with cliff periods
- Cap table upload functionality
- Employee equity tracking
- Company equity overview

### Financing
- Payroll financing application system
- Financing review and approval workflow
- Repayment schedule generation
- Repayment tracking
- Financing statistics and analytics
- Integration with payroll processing

### Audit & Logging
- Comprehensive audit trail for all actions
- Activity tracking by module and user
- Failed operation logging
- Data change tracking (before/after)
- Audit log search and export
- Activity timeline and statistics

### Dashboard
- Role-specific dashboards (Admin, HR, Employee)
- Company metrics and statistics
- Recent activities feed
- Critical activities monitoring
- Payroll and equity overviews

## Technology Stack

### Core Dependencies
- **express**: Web framework for Node.js
- **mongoose**: MongoDB object modeling
- **jsonwebtoken**: JWT implementation for authentication
- **bcrypt**: Password hashing
- **cors**: Cross-origin resource sharing
- **helmet**: Security middleware
- **morgan**: HTTP request logger
- **express-rate-limit**: Rate limiting middleware
- **express-validator**: Request validation
- **brevo**: Email sending capabilities
- **axios**: HTTP client
- **dotenv**: Environment variable management
- **upstash/redis**: Stores queue and cache data
- **bullmq**: Runs background jobs and queues
- **ioredis**: Connects the app to redis

### Development Dependencies
- **nodemon**: Development server with auto-restart

## Prerequisites

Before running this project, ensure you have:

- Node.js (v14 or higher)
- MongoDB (local instance or cloud connection string)
- npm or yarn package manager
- Git (for version control)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd career-pay-backend/career-pay-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables** (see Configuration section)

4. **Start the development server**
   ```bash
   npm run dev
   ```

   Or for production:
   ```bash
   npm run server
   ```

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=your_mongodb_connection_string

# JWT Configuration
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key
JWT_REFRESH_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=http://localhost:3000

# Email Configuration (for brevo)
BREVO_API_KEY=brevo_api_key
SMTP_FROM=your_email@gmail.com
APP_NAME=CareerPay
APP_URL=https://career-pay.onrender.com
```
# API KEYS
EXCHANGE_RATE_API_KEY=your_exchange_rate_api_key
FLUTTERWAVE_SECRET_KEY=your_flutterwave_secret_key
UPSTASH_REDIS_URL=redis_url
FLUTTERWAVE_WEBHOOK_HASH=your_webhook_hash
FLUTTERWAVE_ENV=test
MONNIFY_API_KEY=your_monnify_api_key
MONNIFY_SECRET_KEY=your_monnify_secret_key
MONNIFY_CONTRACT_CODE=your_monnify_contract_code
MONNIFY_BASE_URL=https://sandbox.monnify.com

## Project Structure

```
career-pay-app/
├── config/
│   ├── db.js    
|   ├──  paymentQueue.js        # MongoDB connection configuration
├── controllers/                # Route controllers
│   ├── authController.js       # Authentication endpoints
│   ├── employeeController.js   # Employee management
│   ├── payrollController.js    # Payroll operations
│   ├── equityController.js     # Equity/ESOP management
│   ├── financingController.js  # Financing operations
│   ├── dashboardController.js  # Dashboard data
│   └──subcriptionController.js # Subcription management
├── middlewares/                # Custom middleware
│   ├── authMiddleware.js       # Authentication & authorization
│   ├── errorHandler.js         # Global error handling
│   ├── validator.js            # Input validation
│   ├── auditLogger.js          # Audit logging middleware
│   ├── requireSubscription.js  # Subscription middleware
│   └── role.js                 # Role utilities
├── models/                     # Mongoose schemas
│   ├── userModel.js            # User schema
│   ├── companyModel.js         # Company schema
│   ├── employeeModel.js        # Employee schema
│   ├── payrollModel.js         # Payroll schema
│   ├── esopModel.js            # Equity grant schema
│   ├── financingModel.js       # Financing schema
│   ├── auditModel.js           # Audit log schema
│   ├── loginAttempts.js        # Login attempts schema (tracks login attemts)
│   ├── revokedToken.js         # Revoked token schema (Stores revoked JWT tokens)
│   ├── subcriptionModel.js     # Subscription schema
│   └── paymentTransactionModel.js  # Transaction schema
├── routes/                     # API routes
│   ├── index.js                # Main router
│   ├── authRoutes.js           # Authentication routes
│   ├── employeeRoutes.js       # Employee routes
│   ├── payrollRoutes.js        # Payroll routes
│   ├── esopRoutes.js           # Equity routes
│   ├── financingRoutes.js      # Financing routes
│   ├── dashboardRoutes.js      # Dashboard routes
│   ├── companyRoutes.js        # Company routes
│   └── subscriptionRoutes.js   # Subscription routes
├── services/                   # Business logic services
│   ├── authService.js          # Authentication logic
│   ├── payrollService.js     # Payroll calculations
│   ├── taxCalculationService.js # Tax calculations
│   ├── vestingService.js     # Vesting logic
│   ├── emailService.js       # Email sending
│   └── auditService.js       # Audit operations
│   ├── gateways/             # payment-logic
│   └── flutterwave.js        # flutterwave integration
│   └── monnify.js            # monnify integration
│   └── index.js              
├── utils/                    # Utility functions
│   └── helpers.js            # Helper functions
├── app.js                    # Express app configuration
├── server.js                 # Server entry point
├── package.json              # Dependencies and scripts
└── vercel.json               # Vercel deployment config
```

## API Documentation

All API endpoints are prefixed with `/api`. The base URL structure is:
- Development: `http://localhost:5000/api`
- Production: `https://career-pay.render.com/api`

### Authentication Endpoints

#### Register Company and Founder
```
POST /api/auth/register
Body: {
  company: { name, email, phone, industry, address, baseCurrency },
  user: { email, password, firstName, lastName, phone, position, salary }
}
Response: { user, company, employee, token, refreshToken }
```

#### Login
```
POST /api/auth/login
Body: { email, password }
Response: { user, company, token, refreshToken }
```

#### Logout
```
POST /api/auth/logout
Headers: Authorization: Bearer <token>
Response: { success: true, message: "Logout successful" }
```

#### Refresh Token
```
POST /api/auth/refresh-token
Body: { refreshToken }
Response: { token }
```

#### Forgot Password
```
POST /api/auth/forgot-password
Body: { email }
Response: { message, resetToken (dev only) }
```

#### Reset Password
```
POST /api/auth/reset-password
Body: { resetToken, newPassword }
Response: { success: true, message }
```

#### Change Password
```
POST /api/auth/change-password
Headers: Authorization: Bearer <token>
Body: { currentPassword, newPassword }
Response: { success: true, message }
```

#### Get Current User
```
GET /api/auth/me
Headers: Authorization: Bearer <token>
Response: { user data with company and employee info }
```

#### Verify Token
```
GET /api/auth/verify-token
Headers: Authorization: Bearer <token>
Response: { success: true, data: { userId, role } }
```

### Employee Endpoints

All employee endpoints require authentication. HR, Admin, and Founder roles can access all endpoints. Employees can only access their own data.

#### Create Employee
```
POST /api/employees
Headers: Authorization: Bearer <token>
Body: {
  email, firstName, lastName, phone,
  position, department, employmentType,
  startDate, salary: { amount, currency, payFrequency },
  bankDetails, taxInformation, manager
}
Response: { employee, user }
```

#### Get All Employees
```
GET /api/employees?page=1&limit=50&department=IT&isActive=true&search=john
Headers: Authorization: Bearer <token>
Response: { data: [...], pagination: { page, limit, total, pages } }
```

#### Get Employee by ID
```
GET /api/employees/:id
Headers: Authorization: Bearer <token>
Response: { employee data }
```

#### Update Employee
```
PUT /api/employees/:id
Headers: Authorization: Bearer <token>
Body: { position, department, salary, bankDetails, taxInformation, ... }
Response: { updated employee data }
```

#### Deactivate Employee
```
PATCH /api/employees/:id/deactivate
Headers: Authorization: Bearer <token>
Body: { terminationDate, terminationReason }
Response: { deactivated employee data }
```

#### Activate Employee
```
PATCH /api/employees/:id/activate
Headers: Authorization: Bearer <token>
Response: { activated employee data }
```

#### Delete Employee
```
DELETE /api/employees/:id
Headers: Authorization: Bearer <token>
Response: { success: true, message }
```

#### Get Employee Statistics
```
GET /api/employees/stats
Headers: Authorization: Bearer <token>
Response: { totalEmployees, activeEmployees, byDepartment, byEmploymentType, recentHires }
```

### Payroll Endpoints

All payroll endpoints require authentication. HR and above can create and view payrolls. Only Admin and Founder can approve and process payrolls.

#### Create Payroll
```
POST /api/payroll
Headers: Authorization: Bearer <token>
Body: { month: 1-12, year: 2024 }
Response: { payroll data }
```

#### Get Current Payroll
```
GET /api/payroll/current
Headers: Authorization: Bearer <token>
Response: { current month payroll or creates draft }
```

#### Get All Payrolls
```
GET /api/payroll?year=2024&month=1&status=completed
Headers: Authorization: Bearer <token>
Response: { array of payrolls }
```

#### Get Payroll by ID
```
GET /api/payroll/:id
Headers: Authorization: Bearer <token>
Response: { payroll data with items and summary }
```

#### Calculate Payroll
```
POST /api/payroll/:id/calculate
Headers: Authorization: Bearer <token>
Response: { calculated payroll with all deductions }
```

#### Approve Payroll
```
POST /api/payroll/:id/approve
Headers: Authorization: Bearer <token> (Admin/Founder only)
Response: { approved payroll data }
```

#### Process Payroll
```
POST /api/payroll/:id/process
Headers: Authorization: Bearer <token> (Admin/Founder only)
Body: { useFinancing: boolean }
Response: { processed payroll data }
```

#### Get Payslip
```
GET /api/payroll/:id/payslip/:employeeId
Headers: Authorization: Bearer <token>
Response: { payslip data for employee }
```

#### Export Payroll
```
GET /api/payroll/:id/export
Headers: Authorization: Bearer <token>
Response: { exportable payroll data }
```

#### Get Payroll Statistics
```
GET /api/payroll/stats?year=2024
Headers: Authorization: Bearer <token>
Response: { payroll statistics for the year }
```

#### Tax Estimate
```
POST /api/payroll/tax-estimate
Headers: Authorization: Bearer <token>
Body: { annualIncome }
Response: { tax estimate breakdown }
```

#### Tax Breakdown
```
POST /api/payroll/tax-breakdown
Headers: Authorization: Bearer <token>
Body: { annualGross }
Response: { tax breakdown by bands }
```

### Equity Endpoints

#### Create Equity Grant
```
POST /api/equity/grants
Headers: Authorization: Bearer <token>
Body: {
  employeeId, totalShares, grantType,
  vestingStartDate, vestingPeriodMonths,
  cliffMonths, vestingFrequency, strikePrice, currentFMV
}
Response: { equity grant with vesting schedule }
```

#### Get All Equity Grants
```
GET /api/equity/grants?status=active&grantType=stock_option&employeeId=xxx
Headers: Authorization: Bearer <token>
Response: { array of equity grants }
```

#### Get Equity Grant by ID
```
GET /api/equity/grants/:id
Headers: Authorization: Bearer <token>
Response: { equity grant details }
```

#### Update Equity Grant
```
PUT /api/equity/grants/:id
Headers: Authorization: Bearer <token>
Body: { update fields }
Response: { updated grant }
```

#### Terminate Equity Grant
```
DELETE /api/equity/grants/:id
Headers: Authorization: Bearer <token>
Body: { reason }
Response: { terminated grant }
```

#### Get Employee Equity
```
GET /api/equity/employee/:employeeId
Headers: Authorization: Bearer <token>
Response: { employee equity summary }
```

#### Get My Equity
```
GET /api/equity/my-equity
Headers: Authorization: Bearer <token>
Response: { current user's equity }
```

#### Get Company Equity Overview
```
GET /api/equity/overview
Headers: Authorization: Bearer <token>
Response: { company equity statistics }
```

#### Upload Cap Table
```
POST /api/equity/cap-table/upload
Headers: Authorization: Bearer <token>
Body: { capTableData: [...] }
Response: { successful, failed arrays }
```

#### Process Vesting
```
POST /api/equity/process-vesting
Headers: Authorization: Bearer <token>
Response: { processed grants count }
```

### Financing Endpoints

#### Apply for Financing
```
POST /api/financing/apply
Headers: Authorization: Bearer <token>
Body: {
  requestedAmount, currency, purpose,
  repaymentTermMonths, repaymentFrequency, companyDetails
}
Response: { financing application }
```

#### Get All Financing Applications
```
GET /api/financing?status=active
Headers: Authorization: Bearer <token>
Response: { array of financing applications }
```

#### Get Financing by ID
```
GET /api/financing/:id
Headers: Authorization: Bearer <token>
Response: { financing details }
```

#### Review Financing Application
```
PUT /api/financing/:id/review
Headers: Authorization: Bearer <token> (Admin/Founder only)
Body: {
  status: "approved" | "rejected",
  approvedAmount, interestRate, reviewNotes, rejectionReason
}
Response: { reviewed financing }
```

#### Disburse Financing
```
POST /api/financing/:id/disburse
Headers: Authorization: Bearer <token>
Body: { disbursementReference }
Response: { disbursed financing }
```

#### Make Repayment
```
POST /api/financing/:id/repayment
Headers: Authorization: Bearer <token>
Body: { amount, paymentReference }
Response: { updated financing }
```

#### Get Financing Statistics
```
GET /api/financing/stats
Headers: Authorization: Bearer <token>
Response: { financing statistics }
```

### Dashboard Endpoints

#### Admin Dashboard
```
GET /api/dashboard/admin
Headers: Authorization: Bearer <token>
Response: { company, employees, payroll, equity, financing, recentActivities }
```

#### HR Dashboard
```
GET /api/dashboard/hr
Headers: Authorization: Bearer <token>
Response: { employeeCount, recentHires, upcomingVesting, currentPayroll }
```

#### Employee Dashboard
```
GET /api/dashboard/employee
Headers: Authorization: Bearer <token>
Response: { employee, equity, recentPayslips }
```

#### Get Recent Activities
```
GET /api/dashboard/recent-activities?limit=20
Headers: Authorization: Bearer <token>
Response: { array of recent activities }
```

#### Get Metrics Summary
```
GET /api/dashboard/metrics
Headers: Authorization: Bearer <token>
Response: { employees, payroll, equity, financing metrics }
```

### Health Check

#### API Health Check
```
GET /api/health
Response: { success: true, message: "API is running", timestamp }
```

## Database Models

### User Model
- email (unique, required)
- password (hashed, required)
- firstName, lastName, phone, profilePhoto
- role (founder, admin, hr, employee)
- company (reference)
- isActive, lastLogin
- passwordResetToken, passwordResetExpires, refreshTokens, passwordChangedAt, passwordHistory, loginAttempts,loginAttemptsWindowStart, lockUntil , knownDevices

### Company Model
- name, email (unique), phone, address
- industry, companySize, registrationNumber, taxId, website, logo
- baseCurrency (NGN, USD)
- payrollSettings (paymentDay, payFrequency, enableAutomaticTax, enablePension)
- bankDetails
- emailVerificationToken
- emailVerificationExpires
- subscription (plan, status, startDate. endDate)
- isVerified, isActive, onboardingCompleted, 
- monthsActive, payrollRunsLast3Months, monthlyPayrollCost, hasOutstandingDefault, kycComplete, latePaymentsCount, fundingStage

### Employee Model
- user (reference), company (reference)
- employeeId (auto-generated, unique)
- department, position, employmentType
- startDate, endDate
- salary (amount, currency, payFrequency)
- bankDetails, taxInformation
- manager (reference)
- isActive, terminationDate, terminationReason

### Payroll Model
- company (reference)
- currency
- payrollPeriod (month, year, periodNumber)
- payrollItems (array of employee payroll items)
- summary (totals)
- status (draft, calculated, approved, processing, completed, failed)
- createdBy, approvedBy, approvedAt
- processedBy, processedAt
- financingUsed (reference)
- notes

### PayrollItem Schema (embedded)
- employee (reference)
- baseSalary, grossSalary
- deductions (tax, pension, nhf, otherDeductions)
- additions (bonus, allowances, overtime)
- employerContributions (pension, nhis, itf, nsitf)
- netSalary
- paymentStatus, paymentDate, paymentReference

### ESOP Model (Equity Grant)
- company, employee (references)
- grantType (stock_option, rsu, restricted_stock, phantom_stock)
- totalShares, grantDate
- vestingStartDate, vestingPeriodMonths, cliffMonths
- vestingFrequency (monthly, quarterly, yearly)
- strikePrice, currentFMV
- sharesExercised
- vestingSchedule (array of vesting events)
- status (active, fully_vested, terminated, cancelled)
- notes

### VestingSchedule Schema (embedded)
- vestingDate, sharesVested, cumulativeVested
- isProcessed, processedAt

### Financing Model
- company (reference)
- applicationDate
- requestedAmount, approvedAmount, currency
- creditScore, riskMultiplier, maxCreditLimit
- purpose (payroll, operations, growth, other)
- status (pending, under_review, approved, rejected, disbursed, active, completed, defaulted)
- serviceCharge
- interestRate, repaymentFrequency
- disbursementDate, disbursementReference, disbursedToWallet, graceCutOff
- totalRepaymentAmount, amountRepaid, repaymentTermDays, outstandingBalance
- repaymentSchedule (array)
- financialPartner, companyDetails
- reviewedBy, reviewedAt, reviewNotes, rejectionReason
- documents

### RepaymentSchedule Schema (embedded)
- amount, principal, interest
- isPaid, paidDate, paidAmount, paymentReference

### Audit Model
- company, user (references)
- action (enum of all tracked actions)
- module (auth, company, employee, payroll, equity, financing, subscription, admin, system)
- resourceType, resourceId
- details (mixed), changes (before/after)
- ipAddress, userAgent
- status (success, failure, pending)
- severity (low, medium, high, critical)
- errorMessage, metadata

## Services

### AuthService
Handles authentication business logic:
- Company and user registration
- User login with password verification
- Token generation (access and refresh)
- Password reset and change
- User profile retrieval

### PayrollService
Manages payroll operations:
- Payroll creation and calculation
- Integration with tax calculation service
- Payroll approval and processing
- Payroll disbursement and payment logic
- Payslip generation
- Payroll export
- Statistics calculation

### TaxCalculationService
Nigerian tax compliance calculations:
- PAYE tax calculation with progressive bands
- Consolidated Relief Allowance (CRA)
- Pension contributions (employee 8%, employer 10%)
- National Housing Fund (NHF) - 2.5%
- Employer statutory contributions (ITF 1%, NSITF 1%)
- Tax estimates and breakdowns

### VestingService
Equity vesting management:
- Equity grant creation with vesting schedules
- Automatic vesting schedule generation
- Vesting processing
- Cap table upload and processing
- Employee equity tracking
- Company equity overview

### EmailService
Email functionality:
- Welcome emails
- security alert emails
- Password reset emails
- verification emails
- Notification emails
- payslip emails
- Integration with brevo

### AuditService
Audit log operations:
- Activity logging
- Recent activities retrieval
- Activity filtering and search
- Statistics calculation
- Export functionality

## Middlewares

### Authentication Middleware

#### protect
Verifies JWT token and attaches user to request. Checks:
- Token validity
- User existence and active status
- Company active status
- Password change after token issuance

#### restrictTo(...roles)
Restricts access to specific roles (founder, admin, hr, employee)

#### isFounderOrAdmin
Allows only founder and admin roles

#### isHROrAbove
Allows HR, admin, and founder roles

#### verifyEmployeeOwnership
Ensures employees can only access their own data

### requireVerified
Blocks access to protected features until company email is verified

#### optionalAuth
Optional authentication that doesn't fail if no token provided

#### attachEmployee
Attaches employee record to request for employee-specific routes

### Error Handler Middleware

#### errorHandler
Global error handler that:
- Handles Mongoose errors (CastError, ValidationError, duplicate key)
- Handles JWT errors
- Returns appropriate status codes and messages
- Includes stack trace in development

#### notFound
Handles 404 errors for non-existent routes

#### asyncHandler
Wrapper for async route handlers to catch errors

### Validator Middleware

#### validate
Validates request using express-validator results

#### validateFields
Validates required fields in request body

#### validateQuery
Validates query parameters

#### validatePagination
Validates pagination parameters (page, limit)

#### validateFileUpload
Validates file uploads (type, size)

### Audit Logger Middleware

#### auditLogger
Automatic audit logging for routes

#### logAction
Manual action logging

#### logFailure
Logs failed operations

#### logDataChange
Tracks data changes with before/after states

## Security Features

### Authentication & Authorization
- JWT-based authentication with secure token storage
- Password hashing using bcrypt (12 rounds)
- Password reset tokens with expiration
- Token refresh mechanism
- Role-based access control (RBAC)

### Data Protection
- Password field excluded from queries by default
- Input validation and sanitization
- SQL injection prevention (MongoDB)
- XSS protection via input sanitization

### API Security
- Helmet.js for security headers
- CORS configuration
- Rate limiting (express-rate-limit)
- Request size limits (10MB)
- Environment variable protection

### Audit & Monitoring
- Comprehensive audit logging
- Failed login attempt tracking
- IP address and user agent logging
- Activity monitoring by severity

## Deployment
Render

### Vercel Deployment

The project is configured for Vercel deployment with `vercel.json`:

1. **Connect Repository**
   - Push code to Git repository
   - Connect repository to Vercel

2. **Environment Variables**
   - Set all environment variables in Vercel dashboard
   - Ensure MONGODB_URI is set correctly
   - Configure JWT secrets

3. **Deploy**
   - Automatic deployment on push to main branch
   - Manual deployment available in dashboard

### Environment Variables for Production

Ensure all required environment variables are set:
- MONGODB_URI
- JWT_SECRET
- JWT_REFRESH_SECRET
- CORS_ORIGIN
- EMAIL configuration (if using email features)

### Database Setup

1. Create MongoDB database (local or cloud)
2. Update MONGODB_URI in environment variables
3. Database indexes are created automatically by Mongoose

## Scripts

### Development
```bash
npm run dev      # Start development server with nodemon
```

### Production
```bash
npm run server   # Start production server
```

### Testing
```bash
npm test         # Run tests (to be implemented)
```

## API Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... }
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error message",
  "errors": [ ... ]  // Optional validation errors
}
```

### Pagination Response
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "pages": 2
  }
}
```

## Error Codes

- 200: Success
- 201: Created
- 400: Bad Request (validation errors)
- 401: Unauthorized (authentication required)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 500: Internal Server Error

## Rate Limiting

API endpoints are protected by rate limiting to prevent abuse. Limits are configured per endpoint and can be adjusted in the middleware configuration.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For support and questions, please contact the development team or create an issue in the repository.

## License

ISC
