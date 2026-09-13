# Windows UI Automation — Doppel's invisible hands.
#
# Uses the System.Windows.Automation namespace (built into every Windows
# machine since Vista) to find and interact with UI elements without
# touching the visible mouse, keyboard, or screen.
#
# Input: a JSON file with an array of actions.
# Output: one JSON result per action to stdout.
#
# Actions:
#   find-app       — list all top-level windows of a process
#   find-elements  — find elements inside a window by name/type/id
#   read-element   — read the value or text of an element
#   click-element  — invoke (click) a button/menu/link
#   set-value      — type into an input field or set a combo value
#   expand         — expand a tree node, menu, or combo
#   select-item    — select an item in a list/tab/tree
#   read-table     — read rows from a data grid or list view
#   read-tree      — read the accessible tree of a window (for discovery)

param(
  [Parameter(Mandatory = $true)][string]$Plan,
  [switch]$Background
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

$auto = [System.Windows.Automation.AutomationElement]
$cond = [System.Windows.Automation.Condition]
$prop = [System.Windows.Automation.AutomationProperty]
$tree = [System.Windows.Automation.TreeScope]
$pattern = [System.Windows.Automation.AutomationPattern]

function Find-WindowByProcess {
  param([string]$Name)
  $root = $auto::RootElement
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like "*$Name*" -and $_.MainWindowHandle -ne [IntPtr]::Zero }
  $results = @()
  foreach ($proc in $procs) {
    try {
      $el = $auto::FromHandle($proc.MainWindowHandle)
      if ($el) {
        $results += [ordered]@{
          name    = $el.Current.Name
          id      = $el.Current.AutomationId
          pid     = $proc.Id
          process = $proc.ProcessName
          handle  = [string]$proc.MainWindowHandle
        }
      }
    } catch {}
  }
  return $results
}

function Find-ElementByHandle {
  param([string]$Handle)
  $h = [IntPtr]::new([long]$Handle)
  return $auto::FromHandle($h)
}

function Build-Condition {
  param($Spec)
  $conditions = @()

  if ($Spec.name) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      [string]$Spec.name
    )
  }
  if ($Spec.automationId) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      [string]$Spec.automationId
    )
  }
  if ($Spec.className) {
    $conditions += New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ClassNameProperty,
      [string]$Spec.className
    )
  }
  if ($Spec.controlType) {
    $ctMap = @{
      'Button'   = [System.Windows.Automation.ControlType]::Button
      'Edit'     = [System.Windows.Automation.ControlType]::Edit
      'Text'     = [System.Windows.Automation.ControlType]::Text
      'ComboBox' = [System.Windows.Automation.ControlType]::ComboBox
      'List'     = [System.Windows.Automation.ControlType]::List
      'ListItem' = [System.Windows.Automation.ControlType]::ListItem
      'MenuItem' = [System.Windows.Automation.ControlType]::MenuItem
      'Menu'     = [System.Windows.Automation.ControlType]::Menu
      'Tab'      = [System.Windows.Automation.ControlType]::Tab
      'TabItem'  = [System.Windows.Automation.ControlType]::TabItem
      'Tree'     = [System.Windows.Automation.ControlType]::Tree
      'TreeItem' = [System.Windows.Automation.ControlType]::TreeItem
      'DataGrid' = [System.Windows.Automation.ControlType]::DataGrid
      'DataItem' = [System.Windows.Automation.ControlType]::DataItem
      'CheckBox' = [System.Windows.Automation.ControlType]::CheckBox
      'RadioButton' = [System.Windows.Automation.ControlType]::RadioButton
      'Hyperlink' = [System.Windows.Automation.ControlType]::Hyperlink
      'Window'   = [System.Windows.Automation.ControlType]::Window
      'Document' = [System.Windows.Automation.ControlType]::Document
      'Pane'     = [System.Windows.Automation.ControlType]::Pane
      'Group'    = [System.Windows.Automation.ControlType]::Group
      'Toolbar'  = [System.Windows.Automation.ControlType]::Toolbar
      'StatusBar' = [System.Windows.Automation.ControlType]::StatusBar
    }
    if ($ctMap.ContainsKey($Spec.controlType)) {
      $conditions += New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        $ctMap[$Spec.controlType]
      )
    }
  }

  if ($conditions.Count -eq 0) {
    return [System.Windows.Automation.Condition]::TrueCondition
  }
  if ($conditions.Count -eq 1) {
    return $conditions[0]
  }
  return New-Object System.Windows.Automation.AndCondition($conditions)
}

function Describe-Element {
  param($El, [int]$Depth = 0, [int]$MaxDepth = 0)
  $info = [ordered]@{
    name        = $El.Current.Name
    controlType = $El.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
    automationId = $El.Current.AutomationId
    className   = $El.Current.ClassName
    isEnabled   = $El.Current.IsEnabled
  }

  # Try to read value
  try {
    $vp = $El.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $info['value'] = $vp.Current.Value
  } catch {}

  # Try to read toggle state
  try {
    $tp = $El.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $info['toggleState'] = $tp.Current.ToggleState.ToString()
  } catch {}

  # Try to read selection
  try {
    $sp = $El.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $info['isSelected'] = $sp.Current.IsSelected
  } catch {}

  if ($Depth -lt $MaxDepth) {
    $children = $El.FindAll([System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    if ($children.Count -gt 0) {
      $info['children'] = @()
      $limit = [Math]::Min($children.Count, 50)
      for ($i = 0; $i -lt $limit; $i++) {
        $info['children'] += Describe-Element -El $children[$i] -Depth ($Depth + 1) -MaxDepth $MaxDepth
      }
    }
  }

  return $info
}

# --- main ---

$actions = Get-Content -Raw -Path $Plan | ConvertFrom-Json
if ($actions -isnot [System.Array]) { $actions = @($actions) }

$results = @()

foreach ($action in $actions) {
  $entry = [ordered]@{ kind = $action.kind; ok = $true; detail = '' }

  try {
    switch ($action.kind) {

      'find-app' {
        $found = Find-WindowByProcess -Name ([string]$action.process)
        if ($found.Count -eq 0) { throw "No windows found for '$($action.process)'" }
        $entry.detail = $found
      }

      'find-elements' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $scope = if ($action.deep) { [System.Windows.Automation.TreeScope]::Descendants } else { [System.Windows.Automation.TreeScope]::Children }
        $found = $parent.FindAll($scope, $condition)
        $items = @()
        $limit = [Math]::Min($found.Count, 40)
        for ($i = 0; $i -lt $limit; $i++) {
          $el = $found[$i]
          $items += [ordered]@{
            name        = $el.Current.Name
            controlType = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
            automationId = $el.Current.AutomationId
            className   = $el.Current.ClassName
            index       = $i
          }
        }
        $entry.detail = [ordered]@{ count = $found.Count; items = $items }
      }

      'read-element' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $scope = if ($action.deep) { [System.Windows.Automation.TreeScope]::Descendants } else { [System.Windows.Automation.TreeScope]::Children }
        $el = $parent.FindFirst($scope, $condition)
        if (-not $el) { throw "Element not found" }
        $entry.detail = Describe-Element -El $el -MaxDepth 0
      }

      'click-element' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $scope = if ($action.deep) { [System.Windows.Automation.TreeScope]::Descendants } else { [System.Windows.Automation.TreeScope]::Children }
        $el = $parent.FindFirst($scope, $condition)
        if (-not $el) { throw "Element '$($action.name)' not found" }

        # Try InvokePattern first (buttons, links, menu items)
        $invoked = $false
        try {
          $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $ip.Invoke()
          $invoked = $true
        } catch {}

        # Try TogglePattern (checkboxes)
        if (-not $invoked) {
          try {
            $tp = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
            $tp.Toggle()
            $invoked = $true
          } catch {}
        }

        # Try SelectionItemPattern (list items, tabs)
        if (-not $invoked) {
          try {
            $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
            $sp.Select()
            $invoked = $true
          } catch {}
        }

        if (-not $invoked) { throw "Element '$($action.name)' doesn't support click/invoke" }
        $entry.detail = "Clicked '$($el.Current.Name)'"
      }

      'set-value' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $scope = if ($action.deep) { [System.Windows.Automation.TreeScope]::Descendants } else { [System.Windows.Automation.TreeScope]::Children }
        $el = $parent.FindFirst($scope, $condition)
        if (-not $el) { throw "Element not found" }

        # Try ValuePattern first (text inputs)
        $set = $false
        try {
          $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          $vp.SetValue([string]$action.value)
          $set = $true
        } catch {}

        # Fall back to focusing and typing via SendKeys — but NOT in
        # background mode, where stealing focus would interrupt the user.
        if (-not $set -and -not $Background) {
          try {
            $el.SetFocus()
            Start-Sleep -Milliseconds 100
            # Select all and replace
            [System.Windows.Forms.SendKeys]::SendWait('^a')
            Start-Sleep -Milliseconds 50

            $text = [string]$action.value
            $chunk = 180
            for ($i = 0; $i -lt $text.Length; $i += $chunk) {
              $part = $text.Substring($i, [Math]::Min($chunk, $text.Length - $i))
              # Escape SendKeys special characters
              $escaped = $part
              foreach ($ch in @('{', '}', '(', ')', '+', '^', '%', '~', '[', ']')) {
                $escaped = $escaped.Replace($ch, '{' + $ch + '}')
              }
              [System.Windows.Forms.SendKeys]::SendWait($escaped)
              Start-Sleep -Milliseconds 30
            }
            $set = $true
          } catch {}
        }

        if (-not $set) { throw "Could not set value on this element" }
        $entry.detail = "Set value on '$($el.Current.Name)'"
      }

      'expand' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $el = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if (-not $el) { throw "Element not found" }
        $ep = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $ep.Expand()
        $entry.detail = "Expanded '$($el.Current.Name)'"
      }

      'select-item' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $el = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if (-not $el) { throw "Item '$($action.name)' not found" }
        $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $sp.Select()
        $entry.detail = "Selected '$($el.Current.Name)'"
      }

      'read-table' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $condition = Build-Condition $action
        $grid = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if (-not $grid) { throw "Grid/table not found" }

        $gp = $grid.GetCurrentPattern([System.Windows.Automation.GridPattern]::Pattern)
        $rowCount = [Math]::Min($gp.Current.RowCount, 50)
        $colCount = $gp.Current.ColumnCount
        $rows = @()

        # Try to read headers first
        $headers = @()
        try {
          $tp = $grid.GetCurrentPattern([System.Windows.Automation.TablePattern]::Pattern)
          $headerEls = $tp.Current.GetColumnHeaders()
          foreach ($h in $headerEls) { $headers += $h.Current.Name }
        } catch {}

        for ($r = 0; $r -lt $rowCount; $r++) {
          $row = [ordered]@{}
          for ($c = 0; $c -lt $colCount; $c++) {
            $cell = $gp.GetItem($r, $c)
            $key = if ($headers.Count -gt $c) { $headers[$c] } else { "col$c" }
            $row[$key] = $cell.Current.Name
          }
          $rows += $row
        }
        $entry.detail = [ordered]@{ rows = $rowCount; cols = $colCount; headers = $headers; data = $rows }
      }

      'read-tree' {
        $parent = if ($action.handle) { Find-ElementByHandle $action.handle } else { $auto::RootElement }
        $maxDepth = if ($action.depth) { [int]$action.depth } else { 2 }
        $entry.detail = Describe-Element -El $parent -MaxDepth $maxDepth
      }

      default { throw "Unknown UI auto action '$($action.kind)'" }
    }
  } catch {
    $entry.ok = $false
    $entry.detail = $_.Exception.Message
  }

  $results += $entry
  if (-not $entry.ok) { break }
}

[Console]::Out.WriteLine(($results | ConvertTo-Json -Depth 10 -Compress))
