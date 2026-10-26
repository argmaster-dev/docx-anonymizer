import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1], keep_vba=True)
ws = wb.create_sheet('Сотрудники')
ws.append(['ФИО', 'СНИЛС', 'ИНН', 'Телефон'])
ws.append(['Ястребова Полина Григорьевна', '045-123-678 34', 27409876579, '+7 (916) 555-12-34'])
ws.append(['Горбунов Тимур Ильдарович', '112-233-445 95', 770198765434, '8 903 777-88-99'])
ws['C2'].number_format = '000000000000'
wb.properties.creator = 'Ястребова Полина Григорьевна'
wb.save(sys.argv[2])
