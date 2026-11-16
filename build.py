# 한 폰 앱(jumarble.html)으로 게임판 페이지(board.html)를 만든다 — 앱을 고치면 이걸 다시 실행
import sys
src=open(sys.argv[1] if len(sys.argv)>1 else '../jumarble.html',encoding='utf-8').read()
inject='<script src="js/qrcode.js"></script>\n<script type="module" src="js/net.js"></script>\n</body>'
assert src.count('</body>')==1
open('board.html','w',encoding='utf-8').write(src.replace('</body>',inject).replace('<title>','<title>게임판 · ',1))
print('board.html built')
