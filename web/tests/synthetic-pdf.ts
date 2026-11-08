// Explicitly synthetic two-page PDF with a real xref table. Colored page
// centers let browser tests verify painted pixels rather than an attached frame.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  stream(
    '0.1 0.3 0.8 rg 40 40 220 280 re f\n0 0 0 rg BT /F1 16 Tf 40 360 Td (Synthetic CV - page one) Tj ET',
  ),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  stream(
    '0.8 0.2 0.1 rg 40 40 220 280 re f\n0 0 0 rg BT /F1 16 Tf 40 360 Td (Synthetic CV - page two) Tj ET',
  ),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
function stream(content: string) {
  return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
}
let contents = '%PDF-1.4\n';
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(contents));
  contents += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(contents);
contents += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
contents += offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('');
contents += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
export const syntheticPDF = Buffer.from(contents);
