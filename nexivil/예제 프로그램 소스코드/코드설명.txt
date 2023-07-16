[main code] : +loader.js
당사 플랫폼과 직접 연계되는 모듈로 constructor()를 통해서 input과 output 변수(파일)를 정의,
OnExcute()(일반 실행모듈, ifc파일 불러오기), 
OnAction()(이벤트기반 버튼 실행모듈, excel파일 import/export) 함수를 통해서 실행

[추가 설치 패키지], 당사는 npm 사용
three
uuid
web-ifc

[엑셀 객체 인/아웃 객체형식] : {"name" : sheetname, "data" : [[]]}
+loader/ifcLoader/#getSheets 함수 참고, 

 
