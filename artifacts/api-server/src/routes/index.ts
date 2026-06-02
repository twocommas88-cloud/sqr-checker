import { Router, type IRouter } from "express";
import healthRouter from "./health";
import rulesRouter from "./rules";
import analysesRouter from "./analyses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(rulesRouter);
router.use(analysesRouter);

export default router;
