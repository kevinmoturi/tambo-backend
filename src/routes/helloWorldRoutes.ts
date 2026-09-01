import { Router } from 'express';
import { getHelloWorld } from '../controllers/helloWorldController';

const router = Router();

router.get('/', getHelloWorld);

export default router;
