import express from "express";
import employeeLoanController from "../controllers/employeeLoanController.js";
import {
  requireVerified,
  isHROrAbove,
  attachEmployee,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

router.use(requireVerified);

router.post("/", attachEmployee, employeeLoanController.requestLoan);
router.get("/mine", attachEmployee, employeeLoanController.getMyLoans);
router.patch("/:id/cancel", attachEmployee, employeeLoanController.cancelLoan);

// HR and above
router.get("/", isHROrAbove, employeeLoanController.getCompanyLoans);
router.patch("/:id/approve", isHROrAbove, employeeLoanController.approveLoan);
router.patch("/:id/reject", isHROrAbove, employeeLoanController.rejectLoan);
router.patch("/:id/activate", isHROrAbove, employeeLoanController.activateLoan);

export default router;
