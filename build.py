# Пересобирает index.html: вставляет src/core_tail.js и src/client.js. Шапка (стили, разметка) и список имён берутся из самого index.html.
s = open('index.html', encoding='utf-8').read()
head = s[:s.index('<script>\n/*SHARED-BEGIN*/')]
a = s.index('const RAW = {'); b = s.index('\n', s.index('for (const g in RAW) BASE[g]')) + 1
out = (head + '<script>\n/*SHARED-BEGIN*/\nconst Core = (() => {\n' + s[a:b] + open('src/core_tail.js', encoding='utf-8').read()
       + '})();\n/*SHARED-END*/\n</script>\n<script>\n' + open('src/client.js', encoding='utf-8').read() + '</script>\n')
open('index.html', 'w', encoding='utf-8').write(out)
