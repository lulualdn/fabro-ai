; Fabro uninstaller: ask whether to also remove conversations, settings and downloaded models.
; Never asked (and nothing removed) during an update or a silent uninstall.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfSilent fabro_keep
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Fabro data: conversations, settings, memories and downloaded models?$\r$\n$\r$\nSupprimer aussi vos données Fabro : conversations, réglages, mémoire et modèles téléchargés ?$\r$\n$\r$\n(No / Non = keep them for a later reinstall)" /SD IDNO IDNO fabro_keep
      IfFileExists "$APPDATA\Fabro\uninstall-paths.txt" 0 fabro_rm_appdata
        FileOpen $0 "$APPDATA\Fabro\uninstall-paths.txt" r
        fabro_loop:
          FileRead $0 $1
          StrCmp $1 "" fabro_loop_end
          StrCpy $2 $1 1 -1
          StrCmp $2 "$\n" 0 +2
            StrCpy $1 $1 -1
          StrCpy $2 $1 1 -1
          StrCmp $2 "$\r" 0 +2
            StrCpy $1 $1 -1
          StrCmp $1 "" fabro_loop
          RMDir /r "$1"
          Goto fabro_loop
        fabro_loop_end:
        FileClose $0
      fabro_rm_appdata:
      RMDir /r "$APPDATA\Fabro"
      RMDir /r "$LOCALAPPDATA\fabro-updater"
      RMDir /r "$LOCALAPPDATA\FabroInstaller"
    fabro_keep:
  ${endIf}
!macroend
