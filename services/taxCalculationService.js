class TaxCalculationService {
  // Nigerian PAYE Tax Bands (2024) - Annual Rates
  // These are configurable and should be updated yearly
  TAX_BANDS = [
    { min: 0, max: 800000, rate: 0 },
    { min: 800000, max: 3000000, rate: 15 },
    { min: 3000000, max: 12000000, rate: 18 },
    { min: 12000000, max: 25000000, rate: 21 },
    { min: 25000000, max: 50000000, rate: 23 },
    { min: 50000000, max: Infinity, rate: 25 },
  ];

  // Constants
  PENSION_EMPLOYEE_RATE = 0.08; // 8%
  PENSION_EMPLOYER_RATE = 0.1; // 10%
  NHF_RATE = 0.025; // 2.5%
  NHF_MINIMUM_SALARY = 7000; // Monthly minimum to qualify for NHF
  ITF_RATE = 0.01; // 1% (Industrial Training Fund)
  NSITF_RATE = 0.01; // 1% (NSITF - 1% of total payroll)

  // Tax relief components
  BASE_RELIEF = 200000; // ₦200,000 annually
  CRA_PERCENT = 0.2; // 20% of gross income or ₦200,000 (whichever is higher)
  CRA_MAX = 200000;

  /**
   * Calculate consolidated relief allowance (CRA)
   * CRA = ₦200,000 + 20% of gross income or ₦200,000 (higher of the two)
   */
  calculateCRA(annualGross) {
    const twentyPercent = annualGross * this.CRA_PERCENT;
    const craAmount = Math.max(twentyPercent, this.CRA_MAX);
    return this.BASE_RELIEF + craAmount;
  }

  /**
   * Calculate annual PAYE tax
   */
  calculateAnnualPAYE(annualGross, reliefAmount = null) {
    // Calculate CRA if custom relief not provided
    const totalRelief = reliefAmount || this.calculateCRA(annualGross);

    // Taxable income = Gross - Relief
    const taxableIncome = Math.max(0, annualGross - totalRelief);

    let tax = 0;
    let remainingIncome = taxableIncome;

    // Apply progressive tax bands
    for (const band of this.TAX_BANDS) {
      if (remainingIncome <= 0) break;

      const bandSize = band.max - band.min;
      const taxableInBand = Math.min(remainingIncome, bandSize);

      tax += (taxableInBand * band.rate) / 100;
      remainingIncome -= taxableInBand;
    }

    return Math.round(tax);
  }

  /**
   * Calculate monthly PAYE from annual gross
   */
  calculateMonthlyPAYE(monthlyGross, annualRelief = null) {
    const annualGross = monthlyGross * 12;
    const annualTax = this.calculateAnnualPAYE(annualGross, annualRelief);
    return Math.round(annualTax / 12);
  }

  /**
   * Calculate pension contributions
   * Employee: 8% of basic + transport + housing
   * Employer: 10% of basic + transport + housing
   */
  calculatePension(monthlyGross, pensionableIncome = null) {
    // If specific pensionable income not provided, use full gross
    const pensionBase = pensionableIncome || monthlyGross;

    return {
      employeeContribution: Math.round(
        pensionBase * this.PENSION_EMPLOYEE_RATE,
      ),
      employerContribution: Math.round(
        pensionBase * this.PENSION_EMPLOYER_RATE,
      ),
      totalContribution: Math.round(
        pensionBase * (this.PENSION_EMPLOYEE_RATE + this.PENSION_EMPLOYER_RATE),
      ),
    };
  }

  /**
   * Calculate National Housing Fund (NHF)
   * 2.5% of basic salary for employees earning above ₦3,000/month
   */
  calculateNHF(monthlyGross, basicSalary = null) {
    const salary = basicSalary || monthlyGross;

    // Only applicable if salary is above minimum threshold
    if (salary < this.NHF_MINIMUM_SALARY) {
      return 0;
    }
    return Math.round(salary * this.NHF_RATE);
  }

  /**
   * Calculate employer statutory contributions
   * ITF: 1% of annual payroll
   * NSITF: 1% of total monthly payroll
   */
  calculateEmployerStatutory(monthlyGross) {
    return {
      itf: Math.round(monthlyGross * this.ITF_RATE),
      nsitf: Math.round(monthlyGross * this.NSITF_RATE),
      nhis: 0, // NHIS rate varies, set to 0 for now
    };
  }

  normalizeToUTCMidnight(date) {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Calculate pro-rated amount for a given monthly amount
   * Formula: (monthlyAmount / daysInMonth) × daysWorked
   */
  calculateProration(monthlyAmount, daysInMonth, daysWorked) {
    if (daysWorked >= daysInMonth) return monthlyAmount;
    const dailyRate = monthlyAmount / daysInMonth;
    return Math.round(dailyRate * daysWorked);
  }

  /**
   * Determine if an employee needs pro-rating and calculate days worked
   * Returns { isProrated, daysWorked, daysInMonth, prorationNote }
   */
  getProrationDetails(employee, month, year) {
    // Total calendar days in the payroll month
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    // Period boundaries — normalized to UTC midnight
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month - 1, daysInMonth));

    let workStart = periodStart;
    let workEnd = periodEnd;
    let isProrated = false;
    let isLeaver = false;

    // Mid-month joiner — startDate falls within this payroll month after the 1st
    const startDate = this.normalizeToUTCMidnight(employee.startDate);
    if (
      startDate.getUTCFullYear() === year &&
      startDate.getUTCMonth() + 1 === month &&
      startDate.getUTCDate() > 1
    ) {
      workStart = startDate;
      isProrated = true;
    }

    // Mid-month leaver — terminationDate falls within this payroll month
    if (employee.terminationDate) {
      const termDate = this.normalizeToUTCMidnight(employee.terminationDate);
      if (
        termDate.getUTCFullYear() === year &&
        termDate.getUTCMonth() + 1 === month
      ) {
        workEnd = termDate;
        isProrated = true;
        isLeaver = true;
      }
    }

    if (!isProrated) {
      return {
        isProrated: false,
        daysWorked: daysInMonth,
        daysInMonth,
        prorationNote: null,
      };
    }

    // Guard: workEnd must not be before workStart
    if (workEnd < workStart) {
      return {
        isProrated: false,
        daysWorked: daysInMonth,
        daysInMonth,
        prorationNote: null,
      };
    }

    // Inclusive day count — minimum 1 day
    const daysWorked = Math.max(
      1,
      Math.floor((workEnd - workStart) / (1000 * 60 * 60 * 24)) + 1,
    );

    // Build payslip note
    const formatDate = (d) =>
      d.toLocaleDateString("en-NG", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });

    const prorationNote = isLeaver
      ? `Final salary pro-rated for ${daysWorked} days worked (${formatDate(workStart)}-${formatDate(workEnd)})`
      : `Salary pro-rated for ${daysWorked} days worked (${formatDate(workStart)}-${formatDate(workEnd)})`;

    return { isProrated, daysWorked, daysInMonth, prorationNote };
  }

  /**
   * Complete payroll calculation for a single employee
   */
  calculateEmployeePayroll(employeeData) {
    const {
      grossSalary,
      basicSalary = null, // Optional: if salary is broken down
      allowances = [],
      bonuses = 0,
      overtime = 0,
      otherDeductions = [],
      currency = "NGN",
      taxRelief = null, // Optional: custom tax relief
    } = employeeData;

    // Only calculate Nigerian taxes for NGN currency
    if (currency !== "NGN") {
      return {
        grossSalary,
        deductions: {
          tax: 0,
          pension: 0,
          nhf: 0,
          otherDeductions,
          totalDeductions: otherDeductions.reduce(
            (sum, d) => sum + d.amount,
            0,
          ),
        },
        additions: {
          bonuses,
          allowances,
          overtime,
          totalAdditions:
            bonuses + allowances.reduce((sum, a) => sum + a.amount, 0),
        },
        netSalary: grossSalary + bonuses + overtime,
        currency,
      };
    }

    // Calculate total additions
    const totalAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
    const totalAdditions = bonuses + totalAllowances;
    const adjustedGross = grossSalary + totalAdditions;

    // Calculate deductions
    const pension = this.calculatePension(adjustedGross, basicSalary);
    const tax = this.calculateMonthlyPAYE(
      adjustedGross - pension.employeeContribution,
      taxRelief,
    );
    const nhf = this.calculateNHF(adjustedGross, basicSalary);
    const otherDeductionsTotal = otherDeductions.reduce(
      (sum, d) => sum + d.amount,
      0,
    );

    const totalDeductions =
      tax + pension.employeeContribution + nhf + otherDeductionsTotal;
    const netSalary = adjustedGross - totalDeductions + overtime;

    // Calculate employer contributions
    const employerStatutory = this.calculateEmployerStatutory(adjustedGross);

    return {
      grossSalary: adjustedGross,
      deductions: {
        tax,
        pension: pension.employeeContribution,
        nhf,
        otherDeductions,
        totalDeductions,
      },
      additions: {
        bonuses,
        allowances,
        overtime,
        totalAdditions,
      },
      employerContributions: {
        pension: pension.employerContribution,
        itf: employerStatutory.itf,
        nsitf: employerStatutory.nsitf,
        nhis: employerStatutory.nhis,
        totalEmployerCost:
          pension.employerContribution +
          employerStatutory.itf +
          employerStatutory.nsitf,
      },
      netSalary: Math.round(netSalary),
      currency,
      breakdown: {
        taxableIncome: adjustedGross - pension.employeeContribution,
        taxRate:
          adjustedGross > 0 ? ((tax / adjustedGross) * 100).toFixed(2) : 0,
        takeHomePercentage:
          adjustedGross > 0
            ? ((netSalary / adjustedGross) * 100).toFixed(2)
            : 0,
      },
    };
  }

  /**
   * Calculate payroll for multiple employees
   */
  calculateBatchPayroll(employees) {
    const results = employees.map((emp) => ({
      employeeId: emp.employeeId || emp._id,
      ...this.calculateEmployeePayroll(emp),
    }));

    // Calculate totals
    const summary = {
      totalEmployees: results.length,
      totalGross: results.reduce((sum, r) => sum + r.grossSalary, 0),
      totalDeductions: results.reduce(
        (sum, r) => sum + r.deductions.totalDeductions,
        0,
      ),
      totalNet: results.reduce((sum, r) => sum + r.netSalary, 0),
      totalEmployerContributions: results.reduce(
        (sum, r) => sum + r.employerContributions.totalEmployerCost,
        0,
      ),
      totalCompanyCost: 0,
    };

    summary.totalCompanyCost =
      summary.totalGross + summary.totalEmployerContributions;

    return {
      payrollItems: results,
      summary,
    };
  }

  /**
   * Calculate tax for a specific income bracket (useful for estimates)
   */
  estimateTax(annualIncome) {
    const tax = this.calculateAnnualPAYE(annualIncome);
    const monthlyTax = Math.round(tax / 12);
    const effectiveRate =
      annualIncome > 0 ? ((tax / annualIncome) * 100).toFixed(2) : 0;

    return {
      annualGross: annualIncome,
      annualTax: tax,
      monthlyTax,
      effectiveRate: `${effectiveRate}%`,
      takeHomeAnnual: annualIncome - tax,
      takeHomeMonthly: Math.round((annualIncome - tax) / 12),
    };
  }

  /**
   * Get tax breakdown by band (for visualization)
   */
  getTaxBandBreakdown(annualGross) {
    const totalRelief = this.calculateCRA(annualGross);
    const taxableIncome = Math.max(0, annualGross - totalRelief);

    const breakdown = [];
    let remainingIncome = taxableIncome;
    let cumulativeTax = 0;

    for (const band of this.TAX_BANDS) {
      if (remainingIncome <= 0) break;

      const bandSize = band.max - band.min;
      const taxableInBand = Math.min(remainingIncome, bandSize);
      const taxInBand = (taxableInBand * band.rate) / 100;

      cumulativeTax += taxInBand;

      breakdown.push({
        band: `₦${band.min.toLocaleString()} - ₦${
          band.max === Infinity ? "∞" : band.max.toLocaleString()
        }`,
        rate: `${band.rate}%`,
        taxableAmount: Math.round(taxableInBand),
        taxAmount: Math.round(taxInBand),
        cumulativeTax: Math.round(cumulativeTax),
      });

      remainingIncome -= taxableInBand;
    }

    return {
      annualGross,
      reliefAmount: totalRelief,
      taxableIncome,
      totalTax: Math.round(cumulativeTax),
      breakdown,
    };
  }
}

export default new TaxCalculationService();
