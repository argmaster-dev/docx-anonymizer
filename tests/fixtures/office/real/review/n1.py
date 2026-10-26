import openpyxl, sys
from openpyxl.comments import Comment
from openpyxl.chart import BarChart, Reference
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Сделки'
ws.append(['ФИО', 'ИНН', 'Телефон', 'Менеджер', 'Сумма'])
ws.append(['Лаврентьева Анна Игоревна', 274062111, 79267771122, 'Чернышёв Олег Петрович', 15000])
ws.append(['Мухаметзянов Ринат Альбертович', 770198765434, 79031112233, 'Чернышёв Олег Петрович', 22000])
ws.append(['Огурцова Вера Павловна', 7728168971, 74957654321, 'Шубина Ксения Андреевна', 9000])
ws['B2'].number_format = '0000000000'
ws['B3'].comment = Comment('Проверить ИНН Мухаметзянова, звонить Лаврентьевой Анне Игоревне', 'Шубина Ксения Андреевна')
ws['A4'].comment = Comment('Огурцова В.П. — постоянный клиент', 'Чернышёв Олег Петрович')
ch = BarChart(); ch.add_data(Reference(ws, min_col=5, min_row=1, max_row=4), titles_from_data=True)
ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=4)); ch.title = 'Сделки Лаврентьевой и др.'
ws.add_chart(ch, 'H2')
p = wb.create_sheet('Сводная')
wb.properties.creator = 'Шубина Ксения Андреевна'
wb.save(sys.argv[1])
