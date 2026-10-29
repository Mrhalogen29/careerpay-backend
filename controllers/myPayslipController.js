import Payroll from "../models/payrollModel.js";
import Employee from "../models/employeeModel.js";

const sum = (list = []) =>
  list.reduce((t, x) => t + (Number(x.amount) || 0), 0);

const shape = (payroll, item) => ({
  payrollId: payroll._id,
  period: payroll.payrollPeriod,
  currency: payroll.currency,
  paymentDate: item.paymentDate,
  paymentReference: item.paymentReference,
  baseSalary: item.baseSalary,
  grossSalary: item.grossSalary,
  deductions: {
    tax: item.deductions?.tax || 0,
    pension: item.deductions?.pension || 0,
    nhf: item.deductions?.nhf || 0,
    loanRepayment: item.deductions?.loanRepayment || 0,
    other: sum(item.deductions?.otherDeductions),
  },
  additions: {
    bonus: item.additions?.bonus || 0,
    overtime: item.additions?.overtime || 0,
    allowances: sum(item.additions?.allowances),
  },
  netSalary: item.netSalary,
});

class MyPayslipController {
  async list(req, res) {
    try {
      const employee = await Employee.findOne({
        user: req.user.id,
        company: req.user.company,
      }).select("_id");

      if (!employee) {
        return res.status(403).json({
          success: false,
          message: "No employee record found for your account",
        });
      }

      const payrolls = await Payroll.find({
        company: req.user.company,
        payrollItems: {
          $elemMatch: { employee: employee._id, paymentStatus: "paid" },
        },
      })
        .sort({
          "payrollPeriod.year": -1,
          "payrollPeriod.month": -1,
          "payrollPeriod.periodNumber": -1,
        })
        .limit(12)
        .select("payrollPeriod currency payrollItems")
        .lean();

      const data = payrolls
        .map((p) => {
          const item = p.payrollItems.find(
            (i) =>
              i.employee.toString() === employee._id.toString() &&
              i.paymentStatus === "paid",
          );
          return item ? shape(p, item) : null;
        })
        .filter(Boolean);

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("My payslips error:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to load payslips" });
    }
  }
}

export default new MyPayslipController();
