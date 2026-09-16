import sqlite3

con = sqlite3.connect('data/app.db')
cur = con.cursor()
print('TOTAL', cur.execute('SELECT COUNT(*) FROM estudiantes').fetchone()[0])
print('COURSES')
for row in cur.execute('''
    SELECT c.nombre, COUNT(e.id)
    FROM cursos c
    LEFT JOIN estudiantes e ON e.curso_id = c.id
    JOIN gestiones g ON g.id = c.gestion_id
    WHERE g.activa = 1
    GROUP BY c.id, c.nombre
    ORDER BY c.nombre
'''):
    print(row)
print('OLD_GRADE_COURSES', cur.execute('''
    SELECT c.nombre, COUNT(e.id)
    FROM cursos c
    LEFT JOIN estudiantes e ON e.curso_id = c.id
    JOIN gestiones g ON g.id = c.gestion_id
    WHERE g.activa = 1 AND c.nombre GLOB '[1-6]° Secundaria'
    GROUP BY c.id, c.nombre
''').fetchall())
print('DUPLICATES', cur.execute('''
    SELECT curso_id, nombres, apellidos, COUNT(*)
    FROM estudiantes
    GROUP BY curso_id, nombres, apellidos
    HAVING COUNT(*) > 1
''').fetchall())
con.close()
