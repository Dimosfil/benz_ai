param(
    [int]$MaxLines = 80,
    [switch]$ConfigureProjectLanguage,
    [switch]$ConfigureGitCommitLanguages,
    [switch]$ConfigureSystemLanguage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-InstructionKitVersion {
    param(
        [Parameter(Mandatory = $true)][string]$VersionFile
    )

    if (-not (Test-Path -LiteralPath $VersionFile)) {
        return $null
    }

    $match = Select-String -Path $VersionFile -Pattern '`([0-9]{4}\.[0-9]{2}\.[0-9]{2}(?:\.[0-9]+)?)`' | Select-Object -First 1
    if ($match -and $match.Matches.Count -gt 0) {
        return $match.Matches[0].Groups[1].Value
    }

    return $null
}

function Write-InstructionKitUpdateNotice {
    $provenancePath = "tools/project-memory/instruction-kit.json"
    if (-not (Test-Path -LiteralPath $provenancePath)) {
        return
    }

    try {
        $kit = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host ""
        Write-Host "== Instruction Kit =="
        Write-Host "Could not read $provenancePath; skipping update check."
        return
    }

    if ($kit.update_check -and $kit.update_check.PSObject.Properties.Name -contains "enabled" -and -not $kit.update_check.enabled) {
        return
    }

    $sharedPath = $null
    if ($env:GENERAL_INSTRUCTIONS_HOME) {
        $sharedPath = $env:GENERAL_INSTRUCTIONS_HOME
    }
    elseif ((Test-Path -LiteralPath "VERSION.md") -and (Test-Path -LiteralPath "INDEX.md") -and (Test-Path -LiteralPath "migrations")) {
        $sharedPath = "."
    }
    elseif ($kit.update_check -and ($kit.update_check.PSObject.Properties.Name -contains "shared_library_path") -and $kit.update_check.shared_library_path) {
        $candidate = [string]$kit.update_check.shared_library_path
        if (Test-Path -LiteralPath $candidate) {
            $sharedPath = $candidate
        }
    }
    elseif ($kit.update_check -and ($kit.update_check.PSObject.Properties.Name -contains "source_cache_path") -and $kit.update_check.source_cache_path) {
        $candidate = [string]$kit.update_check.source_cache_path
        if (Test-Path -LiteralPath $candidate) {
            $sharedPath = $candidate
        }
    }
    elseif ($env:LOCALAPPDATA) {
        $candidate = Join-Path $env:LOCALAPPDATA "general-instructions\source-repo"
        if (Test-Path -LiteralPath $candidate) {
            $sharedPath = $candidate
        }
    }

    if (-not $sharedPath) {
        return
    }

    $sharedVersionFile = Join-Path $sharedPath "VERSION.md"
    $latestVersion = Get-InstructionKitVersion -VersionFile $sharedVersionFile
    if (-not $latestVersion) {
        return
    }

    $installedVersion = [string]$kit.instruction_kit_version
    $updateAvailable = $false
    if ($installedVersion) {
        try {
            $updateAvailable = ([version]$installedVersion) -lt ([version]$latestVersion)
        }
        catch {
            $updateAvailable = $installedVersion -ne $latestVersion
        }
    }

    if ($updateAvailable) {
        Write-Host ""
        Write-Host "== Instruction Kit Update =="
        Write-Host "Installed: $installedVersion"
        Write-Host "Available: $latestVersion"
        Write-Host "Review $sharedPath\CHANGELOG.md or run gi обновить to refresh from the configured source repo."
    }
}

function Write-SmallFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Title,
        [int]$Limit = $MaxLines
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $lineCount = (Get-Content -LiteralPath $Path | Measure-Object -Line).Lines
    Write-Host ""
    Write-Host "== $Title =="

    if ($lineCount -le $Limit) {
        Get-Content -LiteralPath $Path
        return
    }

    Write-Host "$Path has $lineCount lines; showing first $Limit lines only."
    Get-Content -LiteralPath $Path -TotalCount $Limit
}

function Write-GitCommitPreferenceNotice {
    $gitPreferencesPath = "tools/project-memory/git-preferences.json"
    Write-Host ""
    Write-Host "== Git Commit Preferences =="

    if ($ConfigureGitCommitLanguages) {
        $selectorPath = "tools/select-git-commit-languages.ps1"
        if (Test-Path -LiteralPath $selectorPath) {
            & $selectorPath
            return
        }

        Write-Host "Could not find $selectorPath."
        Write-Host "Copy it from templates/select-git-commit-languages.template.ps1."
        return
    }

    if (-not (Test-Path -LiteralPath $gitPreferencesPath)) {
        Write-Host "No git commit language preferences found."
        Write-Host "[x] 1. English"
        Write-Host "[ ] 2. Russian"
        Write-Host "[ ] 3. Spanish"
        Write-Host "[ ] 4. German"
        Write-Host "[ ] 5. French"
        Write-Host "Configure them with: .\tools\select-git-commit-languages.ps1"
        Write-Host "Or run startup with: .\tools\agent-start.ps1 -ConfigureGitCommitLanguages"
        return
    }

    try {
        $preferences = Get-Content -LiteralPath $gitPreferencesPath -Raw | ConvertFrom-Json
        $primary = [string]$preferences.commit_message_languages.primary
        $additional = @($preferences.commit_message_languages.additional | ForEach-Object { [string]$_ })
        if (-not $primary) {
            $primary = "English"
        }
        Write-Host "Primary: $primary"
        if ($additional.Count -gt 0) {
            Write-Host ("Additional: {0}" -f ($additional -join ", "))
        }
        else {
            Write-Host "Additional: none"
        }
        Write-Host "Change with: .\tools\select-git-commit-languages.ps1"
        Write-Host "Or run startup with: .\tools\agent-start.ps1 -ConfigureGitCommitLanguages"
    }
    catch {
        Write-Host "Could not read $gitPreferencesPath."
        Write-Host "Reconfigure with: .\tools\select-git-commit-languages.ps1"
    }
}

function Invoke-ProjectLanguageSelector {
    $selectorPath = "tools/select-project-language.ps1"
    if (Test-Path -LiteralPath $selectorPath) {
        & $selectorPath
        return $true
    }

    Write-Host "Could not find $selectorPath."
    Write-Host "Copy it from templates/select-project-language.template.ps1."
    return $false
}

function Write-SystemLanguagePreferenceNotice {
    $systemPreferencesPath = "tools/project-memory/system-preferences.json"
    Write-Host ""
    Write-Host "== Agent System Language =="

    if ($ConfigureSystemLanguage) {
        $selectorPath = "tools/select-system-language.ps1"
        if (Test-Path -LiteralPath $selectorPath) {
            & $selectorPath
            return
        }

        Write-Host "Could not find $selectorPath."
        Write-Host "Copy it from templates/select-system-language.template.ps1."
        return
    }

    if (-not (Test-Path -LiteralPath $systemPreferencesPath)) {
        Write-Host "No agent system language preferences found."
        Write-Host "[x] 1. Match user"
        Write-Host "[ ] 2. English"
        Write-Host "[ ] 3. Russian"
        Write-Host "[ ] 4. Spanish"
        Write-Host "[ ] 5. German"
        Write-Host "[ ] 6. French"
        Write-Host "Configure with: .\tools\select-system-language.ps1"
        Write-Host "Or run startup with: .\tools\agent-start.ps1 -ConfigureSystemLanguage"
        return
    }

    try {
        $preferences = Get-Content -LiteralPath $systemPreferencesPath -Raw | ConvertFrom-Json
        $mode = [string]$preferences.agent_response_language.mode
        $language = [string]$preferences.agent_response_language.language
        $languages = @($preferences.agent_response_language.project_environment_languages | ForEach-Object { [string]$_ })
        if ($languages.Count -eq 0) {
            $languages = @($preferences.agent_response_language.languages | ForEach-Object { [string]$_ })
        }
        $taskLanguages = @($preferences.agent_response_language.task_languages | ForEach-Object { [string]$_ })
        if ($mode -eq "fixed" -and $languages.Count -gt 0) {
            Write-Host ("Project working environment: {0}" -f ($languages -join ", "))
            if ($taskLanguages.Count -gt 0) {
                Write-Host ("Tasks: {0}" -f ($taskLanguages -join ", "))
            }
        }
        elseif ($mode -eq "fixed" -and $language) {
            Write-Host "Agent working language: $language"
        }
        else {
            Write-Host "Agent working language: match the user's language"
        }
        Write-Host "Change with: .\tools\select-system-language.ps1"
        Write-Host "Or run startup with: .\tools\agent-start.ps1 -ConfigureSystemLanguage"
    }
    catch {
        Write-Host "Could not read $systemPreferencesPath."
        Write-Host "Reconfigure with: .\tools\select-system-language.ps1"
    }
}

Write-InstructionKitUpdateNotice

if ($ConfigureProjectLanguage) {
    Write-Host ""
    Write-Host "== Project Language =="
    [void](Invoke-ProjectLanguageSelector)
}

Write-SmallFile -Path "AGENTS.md" -Title "AGENTS.md"
Write-SmallFile -Path "tools/AGENT_WORKING_AGREEMENTS.md" -Title "Working Agreements"
Write-GitCommitPreferenceNotice
Write-SystemLanguagePreferenceNotice

$summaryDir = "tools/summary"
if (Test-Path -LiteralPath $summaryDir) {
    $latestSummary = Get-ChildItem -LiteralPath $summaryDir -Filter "*_AGENT_WORK_SUMMARY.md" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($latestSummary) {
        Write-SmallFile -Path $latestSummary.FullName -Title "Latest Summary" -Limit ([Math]::Min($MaxLines, 80))
    }
}

Write-Host ""
Write-Host "== Git Status =="
git status --short

Write-Host ""
Write-Host "== Git Diff Stat =="
git diff --stat

if (Test-Path -LiteralPath "tools/AGENT_RUNBOOK.md") {
    Write-Host ""
    Write-Host "== Runbook Command Hints =="
    Select-String -Path "tools/AGENT_RUNBOOK.md" -Pattern "```|Install|Run|Test|Build|Smoke|Logs|powershell|npm|pnpm|yarn|dotnet|pytest|cargo|go test" -CaseSensitive:$false |
        Select-Object -First 60 |
        ForEach-Object { $_.Line }
}

if (Test-Path -LiteralPath "tools/project-memory/index_project.py") {
    Write-Host ""
    Write-Host "== Project Memory =="
    Write-Host "Search memory with:"
    Write-Host "python .\tools\project-memory\index_project.py search `"query`" --limit 10"
}

Write-Host ""
Write-Host "Startup restore complete. Use targeted searches before reading large files."
