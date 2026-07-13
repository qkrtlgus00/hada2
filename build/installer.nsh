; hada2 커스텀 NSIS 스크립트
; 설치/업데이트 시 실행 중인 앱을 강제 종료해 "cannot be closed" 재시도 창을 없앤다.
; 하다는 창을 닫아도 트레이로 최소화돼 프로세스가 살아있어, electron-builder 기본
; 종료 절차가 실패하기 때문. customCheckAppRunning 을 정의하면 기본 _CHECK_APP_RUNNING
; (프롬프트 포함)을 대체한다. 이 매크로는 옛 버전 제거(uninstallOldVersion)·파일 추출보다
; 먼저 실행되므로, 여기서 옛/새 실행파일을 모두 죽이면 잠금이 풀려 이후 단계가 성공한다.
!macro customCheckAppRunning
  ; 현재/미래 실행파일 (executableName: hada2)
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  ; 옛 버전 실행파일 (productName '하다' → 하다.exe). 전환 1회용 안전망.
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /t /im "하다.exe"`
  Pop $0
  Sleep 800
!macroend
