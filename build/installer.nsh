; hada2 커스텀 NSIS 스크립트
; 설치/업데이트 시 실행 중인 앱을 강제 종료해 "cannot be closed" 재시도 창을 없앤다.
; 하다는 창을 닫아도 트레이로 최소화돼 프로세스가 살아있어, electron-builder 기본
; 종료 절차가 실패한다. customCheckAppRunning 을 정의하면 기본 _CHECK_APP_RUNNING
; (프롬프트 포함)을 대체하며, 이 매크로는 옛 버전 제거(uninstallOldVersion)·파일 추출보다
; 먼저 실행되므로 여기서 프로세스를 죽이면 잠금이 풀려 이후 단계가 성공한다.
;
; cmd/taskkill 은 한글 이미지명(하다.exe)을 OEM 콘솔 코드페이지에서 매칭하지 못해 종료에
; 실패한다. 따라서 ASCII 이름은 taskkill 로, 한글 포함은 PowerShell Stop-Process(UTF-16
; 네이티브)로 확실히 종료한다.
!macro customCheckAppRunning
  nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /t /im "hada2.exe"`
  Pop $0
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-Process -Name 'hada2','하다' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  Sleep 1000
!macroend
