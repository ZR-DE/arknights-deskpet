' ============================================================
' 桌宠启动器 —— 双击运行，不需要 Node、不需要命令行
'
' 原理：node_modules 里的 electron.exe 是自包含的可执行文件，
'       它本身就是运行环境，不依赖系统安装的 Node.js。
'       这里只是给它补上"启动哪个项目"这个参数。
' ============================================================
Option Explicit

Dim fso, sh, base, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
exe  = base & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "找不到 Electron 运行库：" & vbCrLf & vbCrLf & exe & vbCrLf & vbCrLf & _
         "可能原因：node_modules 没有安装完整。" & vbCrLf & _
         "请在项目目录执行 npm install，或用项目里的 install.cmd。", _
         vbCritical, "桌宠启动失败"
  WScript.Quit 1
End If

sh.CurrentDirectory = base

' 清掉可能被继承的 ELECTRON_RUN_AS_NODE。
' 这个变量会让 Electron 退化成纯 Node 运行，主进程拿不到 app 直接崩溃。
sh.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = ""

sh.Run """" & exe & """ """ & base & """", 1, False
