'use strict';
const fs=require('fs');
function esc(x){return String(x).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function pdfEscape(s){return String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
function makePdf(text){
 const lines=String(text).split('\n').slice(0,60);let content='BT /F1 9 Tf 36 760 Td ';
 for(const line of lines)content+=`(${pdfEscape(line.slice(0,110))}) Tj 0 -12 Td `;content+='ET';
 const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
 let pdf='%PDF-1.4\n',offs=[0];for(let i=0;i<objs.length;i++){offs[i+1]=Buffer.byteLength(pdf);pdf+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`}
 const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offs.length;i++)pdf+=`${String(offs[i]).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(pdf)
}
class ReportGenerator{
 constructor({outputDir='./reports'}={}){this.outputDir=outputDir;fs.mkdirSync(outputDir,{recursive:true})}
 build(result,{title='Institutional Trading Report'}={}){const m=result.metrics||{};const rows=Object.entries(m).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><table>${rows}</table><pre>${esc(JSON.stringify(result,null,2))}</pre></body></html>`}
 write(result,{basename='report',title='Institutional Trading Report'}={}){const htmlPath=`${this.outputDir}/${basename}.html`;fs.writeFileSync(htmlPath,this.build(result,{title}));const trades=result.trades||[];const keys=trades.length?Object.keys(trades[0]):[];const csvPath=`${this.outputDir}/${basename}.csv`;fs.writeFileSync(csvPath,[keys.join(','),...trades.map(t=>keys.map(k=>JSON.stringify(t[k]??'')).join(','))].join('\n'));const jsonPath=`${this.outputDir}/${basename}.json`;fs.writeFileSync(jsonPath,JSON.stringify(result,null,2));const pdfPath=`${this.outputDir}/${basename}.pdf`;fs.writeFileSync(pdfPath,makePdf(`${title}\n\n${JSON.stringify(result.metrics||{},null,2)}`));return {html:htmlPath,csv:csvPath,json:jsonPath,pdf:pdfPath}}
}
module.exports={ReportGenerator};
