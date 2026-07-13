; hada2 커스텀 NSIS 스크립트
; 설치/업데이트 시 실행 중인 앱을 강제 종료해 "cannot be closed" 재시도 창을 없앤다.
; 하다는 창을 닫아도 트레이로 최소화돼 프로세스가 살아있어, electron-builder 기본
; 종료 절차가 실패하기 때문. customCheckAppRunning 을 정의하면 기본 _CHECK_APP_RUNNING
; (프롬프트 포함)을 대체한다.
!macro customCheckAppRunning
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  Sleep 600
!macroend
