# Фикстуры «из настоящих инструментов» (ревью WP12-B): книги openpyxl и pandas, книга, пересохранённая LibreOffice, презентация
# python-pptx (с диаграммой — внутри книга Excel), дополнения, которые пишет Excel (сводная, внешняя книга, подключение, общий
# доступ, цепочки с упоминаниями, SmartArt, комментарии PowerPoint, разделы), CSV/JSON/текст из pandas и в UTF-16 без BOM.
# Все люди, номера и адреса вымышленные. Секреты каждого файла — secrets.json (тест «ни одного исходного значения ни в одной
# части zip»: tests/integration/real-office.spec.js). Результат закоммичен бинарными файлами: байты zip от запуска к запуску
# меняются (время записей), содержание — нет.
#
#   uv run --no-project --with openpyxl==3.1.5 --with python-pptx==1.0.2 --with pandas==3.0.6 \
#     python tests/fixtures/office/real/make_real.py
#   (LibreOffice для lo-resaved.xlsx — необязательно: без soffice/libreoffice файл не пересоздаётся)
import datetime, io, json, os, re, shutil, subprocess, sys, tempfile, zipfile

import openpyxl
import pandas as pd
from openpyxl.chart import BarChart, Reference
from openpyxl.comments import Comment
from openpyxl.packaging.custom import StringProperty
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches

OUT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(OUT, '..', '..', '..', '..'))
WHEN = datetime.datetime(2026, 10, 1, 9, 0, 0)
SECRETS = {}


def inn12(prefix):
    d = [int(c) for c in prefix]
    c1 = sum(a * b for a, b in zip(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8])) % 11 % 10
    d.append(c1)
    c2 = sum(a * b for a, b in zip(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8])) % 11 % 10
    d.append(c2)
    return ''.join(map(str, d))


def inn10(prefix):
    d = [int(c) for c in prefix]
    d.append(sum(a * b for a, b in zip(d, [2, 4, 10, 3, 5, 9, 4, 6, 8])) % 11 % 10)
    return ''.join(map(str, d))


def snils(n9):
    s = sum(int(c) * (9 - i) for i, c in enumerate(n9))
    c = s if s < 100 else 0 if s in (100, 101) else (0 if s % 101 == 100 else s % 101)
    return n9 + '%02d' % c


def fix(wb):
    wb.properties.created = WHEN
    wb.properties.modified = WHEN


def patch_zip(src, dst, edit):
    """Перепаковать zip, изменив части функцией edit(files: dict[str, bytes])."""
    with zipfile.ZipFile(src) as z:
        files = {n: z.read(n) for n in z.namelist()}
    edit(files)
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as o:
        for n, b in files.items():
            o.writestr(n, b)


def add_ct(files, overrides):
    ct = files['[Content_Types].xml'].decode()
    files['[Content_Types].xml'] = ct.replace('</Types>', ''.join(f'<Override PartName="/{p}" ContentType="{t}"/>' for p, t in overrides) + '</Types>').encode()


# ---------- 1. openpyxl: CRM с примечанием, проверкой данных, умной таблицей, диаграммой, именами, скрытыми листами ----------
def openpyxl_crm(path):
    wb = openpyxl.Workbook()
    fix(wb)
    ws = wb.active
    ws.title = 'Клиенты'
    ws.append(['ФИО', 'ИНН', 'Телефон', 'СНИЛС', 'Расчётный счёт', 'Сумма', 'ИНН x2', 'Поиск'])
    ws.append(['Кравченко Ольга Петровна', 7707083893, 79161234567, 11223344595, '40702810900000012345', 1000, '=B2*2', '=VLOOKUP(B2,B2:F4,5,FALSE)'])
    ws.append(['Семенов Артем Викторович', 500100732259, 79035556677, 15975325780, '40817810099910004312', 2000, '=B3*2', '=VLOOKUP(B3,B2:F4,5,FALSE)'])
    ws.append(['Белова Дарья Сергеевна', 7728168971.0, 74951234567.0, 12345678964, '40702810400000098765', 3000, '=B4*2', '=SUM(F2:F4)'])
    ws['B2'].number_format = '0'
    ws['C2'].number_format = '+0 (000) 000-00-00'
    ws['B3'].number_format = '@'
    ws['D3'].number_format = '000-000-000 00'
    ws.row_dimensions[4].hidden = True
    ws['A10'] = 'Ответственный: Захаров Игорь Николаевич, тел. 79265554433'
    ws.merge_cells('A10:E10')
    ws['A2'].comment = Comment('Позвонить Семенову Артему Викторовичу, его ИНН 500100732259', 'Белова Дарья Сергеевна')
    ws.oddHeader.left.text = 'Составил: Белова Дарья Сергеевна'
    ws.oddFooter.right.text = 'Стр. &P'
    ws['A12'] = 'Почта'
    ws['B12'] = 'kravchenko.op@example.ru'
    ws['B12'].hyperlink = 'mailto:kravchenko.op@example.ru'
    dv = DataValidation(type='list', formula1='"Кравченко О.П.,Семенов А.В."', prompt='Выберите: Белова Дарья Сергеевна', promptTitle='Захаров Игорь Николаевич')
    ws.add_data_validation(dv)
    dv.add('A20')
    z = wb.create_sheet('Захаров И.Н.')
    z.append(['Показатель', 'Значение'])
    z.append(['Сделок', 3])
    z.append(['ИНН', 7736050003])
    ws['A14'] = 'Сделок у Захарова'
    ws['B14'] = "='Захаров И.Н.'!B2"
    ws['C14'] = "='Захаров И.Н.'!B3+0"
    h = wb.create_sheet('Скрыто')
    h.sheet_state = 'hidden'
    h.append(['ФИО', 'Паспорт', 'ИНН'])
    h.append(['Гусева Марина Олеговна', '4510 123456', 381102345678])
    vh = wb.create_sheet('Совсем скрыто')
    vh.sheet_state = 'veryHidden'
    vh.append(['ФИО', 'Телефон'])
    vh.append(['Тихонов Павел Андреевич', 79998887766])
    g = wb.create_sheet('График')
    g.append(['Дата', 'Кравченко О.П.', 'Семенов А.В.'])
    g.append(['01.11.2026', 'смена', 'выходной'])
    g.append(['02.11.2026', 'выходной', 'смена'])
    t = Table(displayName='График_смен', ref='A1:C3')
    t.tableStyleInfo = TableStyleInfo(name='TableStyleMedium9', showRowStripes=True)
    g.add_table(t)
    ch = BarChart()
    ch.add_data(Reference(ws, min_col=6, min_row=1, max_row=4), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=4))
    ch.title = 'Суммы: Кравченко Ольга Петровна'
    ws.add_chart(ch, 'J2')
    wb.defined_names['Директор'] = DefinedName('Директор', attr_text='"Кравченко Ольга Петровна"')
    wb.defined_names['ИНН_клиента'] = DefinedName('ИНН_клиента', attr_text="'Клиенты'!$B$2")
    ws['A16'] = 'Директор'
    ws['B16'] = '=Директор'
    ws['C16'] = '=ИНН_клиента*1'
    wb.properties.creator = 'Захаров Игорь Николаевич'
    wb.properties.lastModifiedBy = 'Белова Дарья Сергеевна'
    wb.properties.title = 'Клиенты Кравченко'
    wb.custom_doc_props.append(StringProperty(name='Ответственный', value='Тихонов Павел Андреевич'))
    wb.save(path)
    SECRETS[os.path.basename(path)] = [
        'Кравченко', 'Семенов', 'Белова', 'Захаров', 'Гусева', 'Тихонов', '7707083893', '500100732259', '79161234567',
        '79035556677', '11223344595', '15975325780', '7728168971', '74951234567', '12345678964', '40702810900000012345',
        '40817810099910004312', '40702810400000098765', '79265554433', 'kravchenko.op', '4510 123456', '381102345678', '79998887766', '7736050003',
    ]


# ---------- 2. Ведущие нули и запись чисел: ИНН/СНИЛС/БИК числом, формат и заголовок, «7.7E9» и «…0.0» ----------
def zeros(path):
    a, b, s = inn12('0274098765'), inn10('027409876'), snils('012345679')
    wb = openpyxl.Workbook()
    fix(wb)
    ws = wb.active
    ws.title = 'Реестр'
    ws.append(['ФИО', 'ИНН', 'ИНН организации', 'СНИЛС', 'БИК', 'Телефон', 'ИНН банка'])
    ws.append(['Сафина Алия Ринатовна', int(a), int(b), int(s), 44525225, 89171234567, 7728168971])
    ws['B2'].number_format = '000000000000'
    ws['D2'].number_format = '000-000-000 00'  # C2 — ИНН с ведущим нулём без формата: нули — по заголовку
    ws.append(['Галиев Тимур Рустамович', int(inn12('0123456789')), int(inn10('012345678')), int(snils('001234567')), 44525225, 89172223344, 500100732259])
    wb.save(path)

    def edit(files):
        x = files['xl/worksheets/sheet1.xml'].decode()
        # целые так, как их пишут другие инструменты: экспонента и «.0», t="n" явно
        x = x.replace('<v>7728168971</v>', '<v>7.728168971E9</v>').replace('<v>89172223344</v>', '<v>89172223344.0</v>')
        x = re.sub(r'<c r="([A-Z]+\d+)"( s="\d+")?>', lambda m: f'<c r="{m.group(1)}"{m.group(2) or ""} t="n">', x)
        files['xl/worksheets/sheet1.xml'] = x.encode()

    patch_zip(path, path, edit)
    # как значения записаны в исходнике (без ведущих нулей, «7.728168971E9», «89172223344.0»)
    SECRETS[os.path.basename(path)] = [
        'Сафина', 'Галиев', a[1:], b[1:], s[1:], '89171234567', '89172223344', '7.728168971E9', '500100732259',
        inn12('0123456789')[1:], inn10('012345678')[1:], snils('001234567')[2:],
    ]


# ---------- 3. pandas → Excel (openpyxl), примечание дописано openpyxl ----------
def pandas_xlsx(path):
    df = pd.DataFrame(
        {
            'ФИО': ['Орлова Вера Степановна', 'Егоров Константин Ильич'],
            'ИНН': [int(inn12('7701234567')), int(inn10('770123456'))],
            'Телефон': ['+7 916 111-22-33', '+7 903 444-55-66'],
            'Email': ['v.orlova@example.org', 'k.egorov@example.net'],
        }
    )
    df.to_excel(path, index=False, sheet_name='Выгрузка')
    wb = openpyxl.load_workbook(path)
    fix(wb)
    wb['Выгрузка']['A2'].comment = Comment('Клиент Орловой, паспорт 4512 654321', 'Егоров Константин Ильич')
    wb.save(path)
    SECRETS[os.path.basename(path)] = ['Орлова', 'Егоров', inn12('7701234567'), inn10('770123456'), '111-22-33', '444-55-66', 'v.orlova', 'k.egorov', '4512 654321']


# ---------- 4. LibreOffice: пересохранённая книга openpyxl (общие строки, свой порядок частей) ----------
def lo_resave(src, path):
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice:
        print('LibreOffice нет — lo-resaved.xlsx не пересоздаётся', file=sys.stderr)
        return
    work = os.path.join(ROOT, 'test-output', 'make-real-lo')  # snap-LibreOffice не видит /tmp и скрытые каталоги
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    shutil.copy(src, os.path.join(work, 'in.xlsx'))
    subprocess.run([soffice, f'-env:UserInstallation=file://{work}/profile', '--headless', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', os.path.join(work, 'out'), os.path.join(work, 'in.xlsx')], check=True, capture_output=True)
    shutil.copy(os.path.join(work, 'out', 'in.xlsx'), path)
    shutil.rmtree(work, ignore_errors=True)
    SECRETS[os.path.basename(path)] = list(SECRETS['openpyxl-crm.xlsx'])


# ---------- 5. Части, которые пишет Excel: сводная, внешняя книга, подключение, общий доступ, упоминание, константа имени ----------
def excel_extras(path):
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

    def edit(files):
        tc = files['xl/threadedComments/threadedComment1.xml'].decode()
        tc = tc.replace(
            '</threadedComment></ThreadedComments>',
            '</threadedComment><threadedComment ref="A3" dT="2026-10-02T09:00:00.00" personId="{00000001-0000-4000-8000-000000000000}" id="{00000100-0000-4000-8000-000000000002}">'
            '<text>@Лаптев Глеб Романович посмотри ИНН 7707083893</text><mentions><mention mentionpersonId="{00000002-0000-4000-8000-000000000000}" '
            'mentionId="{00000300-0000-4000-8000-000000000001}" startIndex="0" length="22"/></mentions></threadedComment></ThreadedComments>',
        )
        files['xl/threadedComments/threadedComment1.xml'] = tc.encode()
        p = files['xl/persons/person.xml'].decode().replace(
            '</personList>', '<person displayName="Лаптев Глеб Романович" id="{00000002-0000-4000-8000-000000000000}" userId="g.laptev@example.net" providerId="AD"/></personList>'
        )
        files['xl/persons/person.xml'] = p.encode()
        files['xl/pivotCache/pivotCacheDefinition1.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheDefinition xmlns="{ns}" xmlns:r="{r}" refreshedBy="Лаптев Глеб Романович" '
            'refreshedDate="45000" createdVersion="8" refreshedVersion="8" recordCount="2"><cacheSource type="worksheet"><worksheetSource ref="A1:B3" sheet="Задачи"/>'
            '</cacheSource><cacheFields count="2"><cacheField name="ФИО" numFmtId="0"><sharedItems count="2"><s v="Кравцова Дарья Олеговна"/><s v="Лаптев Глеб Романович"/>'
            '</sharedItems></cacheField><cacheField name="ИНН" numFmtId="0"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" '
            'containsInteger="1" minValue="500100732259" maxValue="7707083893" count="2"><n v="7707083893"/><n v="500100732259"/></sharedItems></cacheField>'
            '</cacheFields></pivotCacheDefinition>'
        ).encode()
        files['xl/pivotCache/pivotCacheRecords1.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<pivotCacheRecords xmlns="{ns}" count="2"><r><x v="0"/><n v="7707083893"/></r>'
            '<r><x v="1"/><n v="500100732259"/></r></pivotCacheRecords>'
        ).encode()
        files['xl/externalLinks/externalLink1.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<externalLink xmlns="{ns}" xmlns:r="{r}"><externalBook r:id="rId1"><sheetNames>'
            '<sheetName val="Кравцова Д.О."/></sheetNames><sheetDataSet><sheetData sheetId="0"><row r="1"><cell r="A1" t="str"><v>Кравцова Дарья Олеговна</v></cell>'
            '<cell r="B1"><v>7707083893</v></cell></row></sheetData></sheetDataSet></externalBook></externalLink>'
        ).encode()
        files['xl/externalLinks/_rels/externalLink1.xml.rels'] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" '
            'Target="file:///C:/Users/laptev.g/Documents/%D0%9B%D0%B0%D0%BF%D1%82%D0%B5%D0%B2.xlsx" TargetMode="External"/></Relationships>'
        ).encode()
        files['xl/connections.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<connections xmlns="{ns}"><connection id="1" name="CRM Лаптев" type="1" refreshedVersion="8">'
            '<dbPr connection="DSN=crm;UID=g.laptev;PWD=Secret123;Description=Лаптев Глеб Романович" command="SELECT * FROM clients WHERE inn=7707083893"/>'
            '</connection></connections>'
        ).encode()
        files['xl/usernames.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<users xmlns="{ns}" count="1"><userInfo guid="{{11111111-1111-1111-1111-111111111111}}" '
            'name="Лаптев Глеб Романович" id="1" dateTime="2026-10-01T09:00:00"/></users>'
        ).encode()
        wb = files['xl/workbook.xml'].decode()
        view = '<customWorkbookViews><customWorkbookView name="Лаптев Глеб Романович - личное представление" guid="{22222222-2222-2222-2222-222222222222}" windowWidth="1000" windowHeight="800" activeSheetId="1"/></customWorkbookViews>'
        wb = re.sub(r'(</bookViews>)', '\\1' + view, wb, count=1) if '</bookViews>' in wb else wb.replace('<sheets>', view + '<sheets>', 1)
        wb = wb.replace('</sheets>', '</sheets><definedNames><definedName name="Подписант">"Кравцова Дарья Олеговна"</definedName></definedNames>', 1)
        files['xl/workbook.xml'] = wb.encode()
        wr = files['xl/_rels/workbook.xml.rels'].decode().replace(
            '</Relationships>',
            '<Relationship Id="rId90" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/>'
            '<Relationship Id="rId91" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/>'
            '<Relationship Id="rId92" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/>'
            '<Relationship Id="rId93" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/usernames" Target="usernames.xml"/></Relationships>',
        )
        files['xl/_rels/workbook.xml.rels'] = wr.encode()
        files['xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels'] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>'
        ).encode()
        add_ct(
            files,
            [
                ('xl/pivotCache/pivotCacheDefinition1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheDefinition+xml'),
                ('xl/pivotCache/pivotCacheRecords1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml'),
                ('xl/externalLinks/externalLink1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml'),
                ('xl/connections.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml'),
                ('xl/usernames.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.userNames+xml'),
            ],
        )

    patch_zip(os.path.join(ROOT, 'tests/fixtures/office/comments.xlsx'), path, edit)
    SECRETS[os.path.basename(path)] = ['Лаптев', 'Кравцова', '7707083893', '500100732259', 'laptev', 'Secret123', 'Соболева', 'Тимофеев', '4512 563019', 'Кравцова Дарья']


# ---------- 6. python-pptx: заголовок, текст, ссылка, заметки, таблица, группа, alt, диаграмма (книга внутри) ----------
def pptx_deck(path):
    prs = Presentation()
    s1 = prs.slides.add_slide(prs.slide_layouts[1])
    s1.shapes.title.text = 'Отчёт менеджера Кравченко Ольги Петровны'
    body = s1.placeholders[1].text_frame
    body.text = 'Клиент: Семенов Артем Викторович, тел. +7 916 123-45-67'
    run = body.add_paragraph().add_run()
    run.text = 'Почта: kravchenko.op@example.ru'
    run.hyperlink.address = 'mailto:kravchenko.op@example.ru'
    s1.notes_slide.notes_text_frame.text = 'Сказать про Белову Дарью Сергеевну, её СНИЛС 112-233-445 95'
    s2 = prs.slides.add_slide(prs.slide_layouts[5])
    s2.shapes.title.text = 'Контакты'
    tbl = s2.shapes.add_table(4, 3, Inches(0.5), Inches(1.5), Inches(9), Inches(2)).table
    rows = [['ФИО', 'Телефон', 'ИНН'], ['Захаров Игорь Николаевич', '+7 926 555-44-33', '7707083893'], ['Гусева Марина Олеговна', '+7 999 888-77-66', '500100732259'], ['Тихонов Павел Андреевич', '+7 903 555-66-77', '7728168971']]
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            tbl.cell(i, j).text = v
    s3 = prs.slides.add_slide(prs.slide_layouts[6])
    grp = s3.shapes.add_group_shape()
    tb = grp.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
    tb.text_frame.text = 'Подписант: Лаптев Глеб Романович'
    tb2 = grp.shapes.add_textbox(Inches(1), Inches(2), Inches(4), Inches(1))
    tb2.text_frame.text = 'Паспорт 4510 123456'
    tb2._element.nvSpPr.cNvPr.set('descr', 'Скан паспорта Лаптева Глеба Романовича')
    cd = CategoryChartData()
    cd.categories = ['Кравченко О.П.', 'Семенов А.В.']
    cd.add_series('Продажи', (10, 20))
    gf = s3.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(5), Inches(1), Inches(4), Inches(3), cd)
    gf.chart.has_title = True
    gf.chart.chart_title.text_frame.text = 'Продажи Кравченко Ольги Петровны'
    prs.core_properties.author = 'Захаров Игорь Николаевич'
    prs.core_properties.last_modified_by = 'Белова Дарья Сергеевна'
    prs.core_properties.created = WHEN
    prs.core_properties.modified = WHEN
    prs.save(path)
    SECRETS[os.path.basename(path)] = [
        'Кравченко', 'Семенов', 'Белов', 'Захаров', 'Гусева', 'Тихонов', 'Лаптев', '916 123-45-67', 'kravchenko.op', '112-233-445 95', '555-44-33', '888-77-66',
        '555-66-77', '7707083893', '500100732259', '7728168971', '4510 123456',
    ]


# ---------- 7. PowerPoint: SmartArt, комментарии, разделы, имя слайда, подсказка ссылки ----------
def pptx_extras(src, path):
    A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    P = 'http://schemas.openxmlformats.org/presentationml/2006/main'

    def edit(files):
        files['ppt/diagrams/data1.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="{A}">'
            '<dgm:ptLst><dgm:pt modelId="{1}" type="doc"><dgm:prSet phldrT="[Текст]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ru-RU"/></a:p>'
            '</dgm:t></dgm:pt><dgm:pt modelId="{2}"><dgm:prSet phldrT="[Текст]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU"/>'
            '<a:t>Руководитель: Орлова Вера Степановна</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="{3}"><dgm:prSet phldrT="[Текст]"/><dgm:spPr/><dgm:t><a:bodyPr/>'
            '<a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU"/><a:t>Зам: Егоров</a:t></a:r><a:r><a:rPr lang="ru-RU" b="1"/><a:t> Константин Ильич</a:t></a:r></a:p></dgm:t>'
            '</dgm:pt></dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/></dgm:dataModel>'
        ).encode()
        files['ppt/diagrams/drawing1.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dsp:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" '
            f'xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="{A}"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/>'
            '</dsp:nvGrpSpPr><dsp:grpSpPr/><dsp:sp modelId="{2}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="0" y="0"/>'
            '<a:ext cx="100" cy="100"/></a:xfrm></dsp:spPr><dsp:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU"/><a:t>Руководитель: Орлова Вера Степановна</a:t>'
            '</a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>'
        ).encode()
        files['ppt/commentAuthors.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmAuthorLst xmlns:a="{A}" xmlns:p="{P}"><p:cmAuthor id="1" name="Орлова Вера Степановна" '
            'initials="ОВС" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>'
        ).encode()
        files['ppt/comments/comment1.xml'] = (
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:cmLst xmlns:a="{A}" xmlns:p="{P}"><p:cm authorId="1" dt="2026-10-01T10:00:00.000" idx="1">'
            '<p:pos x="10" y="10"/><p:text>Уточнить у Егорова Константина Ильича, тел. 89161112233</p:text></p:cm></p:cmLst>'
        ).encode()
        s1 = files['ppt/slides/slide1.xml'].decode().replace('<p:cSld>', '<p:cSld name="Слайд Семенова Артема">', 1)
        s1 = re.sub(r'<a:hlinkClick ([^>]*?)/>', r'<a:hlinkClick \1 tooltip="Написать Кравченко Ольге Петровне"/>', s1)
        files['ppt/slides/slide1.xml'] = s1.encode()
        pr = files['ppt/presentation.xml'].decode().replace(
            '</p:presentation>',
            '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">'
            '<p14:section name="Доклад Орловой Веры Степановны" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst/></p14:section></p14:sectionLst></p:ext></p:extLst></p:presentation>',
        )
        files['ppt/presentation.xml'] = pr.encode()
        add_ct(
            files,
            [
                ('ppt/diagrams/data1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml'),
                ('ppt/diagrams/drawing1.xml', 'application/vnd.ms-office.drawingml.diagramDrawing+xml'),
                ('ppt/commentAuthors.xml', 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml'),
                ('ppt/comments/comment1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml'),
            ],
        )

    patch_zip(src, path, edit)
    SECRETS[os.path.basename(path)] = SECRETS[os.path.basename(src)] + ['Орлов', 'Егоров', '89161112233']


# ---------- 8. Текстовые форматы ----------
def text_files():
    df = pd.DataFrame(
        {
            'ФИО': ['Кравченко Ольга Петровна', 'Белова Дарья Сергеевна'],
            'ИНН': [7707083893, 500100732259],
            'Телефон': ['+7 916 123-45-67', '8 903 555-66-77'],
            'Комментарий': ['звонить вечером; "срочно"', 'Семенов Артем Викторович просил перезвонить'],
        }
    )
    df.to_csv(os.path.join(OUT, 'pandas-cp1251.csv'), sep=';', index=False, encoding='cp1251')
    df.to_csv(os.path.join(OUT, 'pandas-utf16.csv'), sep='\t', index=False, encoding='utf-16')
    SECRETS['pandas-cp1251.csv'] = SECRETS['pandas-utf16.csv'] = ['Кравченко', 'Белова', 'Семенов', '7707083893', '500100732259', '916 123-45-67', '903 555-66-77']
    data = {
        'clients': [
            {'fio': 'Кравченко Ольга Петровна', 'clientInn': 7728168971, 'contactPhone': 79161234567, 'snils_number': 11223344595, 'phone_mobile': 79035556677,
             'id': 7707083893, 'note': 'Звонил "Семенов Артем Викторович"'},
        ],
        'Белова Дарья Сергеевна': {'role': 'бухгалтер', 'ИНН': 500100732259},
    }
    with open(os.path.join(OUT, 'pandas-export.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    SECRETS['pandas-export.json'] = ['Кравченко', 'Семенов', 'Белова', '7728168971', '79161234567', '11223344595', '79035556677', '7707083893', '500100732259']
    with open(os.path.join(OUT, 'utf16-nobom.txt'), 'wb') as f:
        f.write('Сотрудник Орлова Вера Степановна, ИНН 7707083893, тел. +7 916 123-45-67\n'.encode('utf-16-le'))
    SECRETS['utf16-nobom.txt'] = ['Орлова', '7707083893', '916 123-45-67']


def main():
    openpyxl_crm(os.path.join(OUT, 'openpyxl-crm.xlsx'))
    zeros(os.path.join(OUT, 'openpyxl-zeros.xlsx'))
    pandas_xlsx(os.path.join(OUT, 'pandas-clients.xlsx'))
    lo_resave(os.path.join(OUT, 'openpyxl-crm.xlsx'), os.path.join(OUT, 'lo-resaved.xlsx'))
    excel_extras(os.path.join(OUT, 'excel-extras.xlsx'))
    pptx_deck(os.path.join(OUT, 'python-pptx-deck.pptx'))
    pptx_extras(os.path.join(OUT, 'python-pptx-deck.pptx'), os.path.join(OUT, 'python-pptx-extras.pptx'))
    text_files()
    with open(os.path.join(OUT, 'secrets.json'), 'w', encoding='utf-8') as f:
        json.dump(SECRETS, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print('записано:', ', '.join(sorted(SECRETS)))


if __name__ == '__main__':
    main()
