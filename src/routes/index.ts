import { Router } from 'express';
import { identifyController } from '../controllers/identifyController';

const router = Router();

router.post('/identify', identifyController);

export default router;
