/**
 * POST /download  { partCode, keyComposite, format, locale? }
 *
 * Placeholder: returns a small text blob describing the selection.
 * Real implementation (Java backend) should stream a STEP/DWG/IGES/STL file
 * from the CAD-generation service.
 */
import { Router } from 'express';

const router = Router();

router.post('/download', (req, res) => {
  const { partCode, keyComposite, format } = req.body ?? {};
  if (!partCode || !format) {
    return res.status(400).json({ error: 'partCode_and_format_required' });
  }
  const content = [
    '# BizMech proxy — placeholder download',
    `PartCode   : ${partCode}`,
    `KeyCompos. : ${keyComposite ?? ''}`,
    `Format     : ${format}`,
    '',
    'The Node.js proxy does not generate CAD files. This will be produced',
    'by the Java backend once it is deployed.',
  ].join('\n');
  const fileName = `${partCode}_${String(keyComposite ?? '').replace(/[^\w.-]+/g, '_')}.${String(format).toLowerCase()}.txt`;
  const url = `data:text/plain;charset=utf-8;base64,${Buffer.from(content, 'utf8').toString('base64')}`;
  res.json({ fileName, mimeType: 'text/plain', url });
});

export default router;
