import io, sys, zipfile, re
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches
from docx import Document
# 1) диаграмма из python-pptx
prs = Presentation(); s = prs.slides.add_slide(prs.slide_layouts[6])
cd = CategoryChartData(); cd.categories = ['Ястребова Полина Григорьевна', 'Горбунов Тимур Ильдарович', 'Огурцова Вера Павловна']
cd.add_series('Сделки Шубиной К.А.', (15000, 22000, 9000))
s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1), Inches(6), Inches(4), cd)
pb = io.BytesIO(); prs.save(pb); pz = zipfile.ZipFile(pb)
chart = pz.read('ppt/charts/chart1.xml').decode()
crels = pz.read('ppt/charts/_rels/chart1.xml.rels').decode()
xl_name = re.search(r'Target="\.\./embeddings/([^"]+)"', crels).group(1)
book = pz.read('ppt/embeddings/' + xl_name)
# 2) документ python-docx
d = Document()
d.add_paragraph('Отчёт подготовила Ястребова Полина Григорьевна, ИНН 027409876579.')
d.add_paragraph('Крупнейший клиент — Горбунов Тимур Ильдарович.')
d.add_paragraph('[[CHART]]')
db = io.BytesIO(); d.save(db); dz = zipfile.ZipFile(db)
out = zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED)
drawing = ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
  '<wp:extent cx="5486400" cy="3200400"/><wp:docPr id="1" name="Диаграмма 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
  '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')
for it in dz.infolist():
    x = dz.read(it.filename)
    if it.filename == 'word/document.xml':
        t = x.decode(); t = re.sub(r'<w:r>(?:(?!<w:r>).)*?\[\[CHART\]\](?:(?!</w:r>).)*</w:r>', drawing, t, flags=re.S); x = t.encode()
    elif it.filename == 'word/_rels/document.xml.rels':
        x = x.decode().replace('</Relationships>', '<Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>').encode()
    elif it.filename == '[Content_Types].xml':
        t = x.decode()
        if 'Extension="xlsx"' not in t:
            t = t.replace('<Default ', '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Default ', 1)
        t = t.replace('</Types>', '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>')
        x = t.encode()
    out.writestr(it, x)
out.writestr('word/charts/chart1.xml', chart)
out.writestr('word/charts/_rels/chart1.xml.rels', crels)
out.writestr('word/embeddings/' + xl_name, book)
out.close()
print(xl_name)
