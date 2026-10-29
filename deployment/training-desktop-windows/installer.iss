#define AppName "Hidden Oasis Operations Training"
#define AppVersion "1.0.0"
#define AppPublisher "Hidden Oasis"
#define AppExecutable "HiddenOasisTraining.exe"

[Setup]
AppId={{5CDE176D-A66A-42BB-954A-2316E3317056}
#ifdef TRAINING_SIGNED_RELEASE
; Compile-time SignTool comes exclusively from an owner-approved protected
; manual main-branch release. Inno signs setup, uninstaller and self-copies.
SignTool=training_sign
SignedUninstaller=yes
#endif
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\Hidden Oasis Operations Training
DefaultGroupName=Hidden Oasis Training
OutputDir=..\..\dist\installer
OutputBaseFilename=Hidden_Oasis_Operations_Training_Windows_Standalone_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayName={#AppName}
DisableProgramGroupPage=yes
ChangesAssociations=no
CloseApplications=no
RestartApplications=no
DisableWelcomePage=no

[Files]
Source: "..\..\dist\desktop\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Hidden Oasis Training"; Filename: "{app}\{#AppExecutable}"
Name: "{autodesktop}\Hidden Oasis Training"; Filename: "{app}\{#AppExecutable}"

[Run]
Filename: "{app}\{#AppExecutable}"; Description: "Start Hidden Oasis Training"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Deliberately NEVER delete %LOCALAPPDATA%\HiddenOasis\OperationsTraining.
; Training database, sample work and private credentials belong to the local user.
