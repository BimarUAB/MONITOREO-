import openpyxl

p = r'C:\Users\BIMAR\Desktop\UAB 2.2026\PRACTICA EMPRESARIAL\LISTAS JM.xlsx'
wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
ws = wb['LISTAS']
vals = []
for row in ws.iter_rows(min_row=1, max_row=ws.max_row, min_col=1, max_col=1, values_only=True):
    vals.append(row[0])
nonempty = []
for v in vals:
    if v is not None and str(v).strip() != '':
        s = str(v).strip()
        if s not in nonempty:
            nonempty.append(s)
print('UNIQUE_A_VALUES', nonempty)
print('COUNT', len(nonempty))
print('FIRST_50_ROWS')
for row in ws.iter_rows(min_row=1, max_row=min(60, ws.max_row), values_only=True):
    print(row)
