import { reply, reviewerStatus } from '../../server/alphaGenomeCloud.js';
export default function handler(req, res) {
  if (req.method !== 'GET') return reply(res, 405, { error: 'GET required' });
  reply(res, 200, reviewerStatus(req));
}
