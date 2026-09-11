#!/usr/bin/env bash
# ==============================================================================
# ABLITERATED AI - MATRIX TERMINAL ENGINE  v4.1
# ==============================================================================
# Verified against macOS default bash 3.2.57 constraints (Apple Silicon /
# M-series included). No bash 4+ syntax, no GNU-only coreutils flags.
#
#   Phase 1  Cryptographic hex memory uplink
#   Phase 2  Hydra v2 root escalation
#   Phase 3  Hollywood cipher decryption
#   Phase 4  Matrix rain cascade
#   Phase 5  Time-dilation gravitational freeze
#   Phase 6  Skull materialisation -> ABLITERATED logo -> skull dissolve
#   Phase 7  Timed blue rain to 30s (or --screensaver forever)
#
# ------------------------------------------------------------------------------
# v4.0 CHANGELOG
# ------------------------------------------------------------------------------
#  - Phases 1-2 stay matrix green. After the hydra terminal sequence the
#    whole world (bg + rain + skull + logo) flips to blue.
#  - LEGS / ELI / POLI lines type out then dwell with a blinking cursor.
#  - Blue accent throughout the post-shift world (never red). ~4 particle tier on the skull's right
#    spray field, matching the attached density-skull but in blue.
#  - Logo is ABLITERATED only (AI plates removed).
#  - Default run is 30s then exit. First 10s of rain convert green->blue.
#  - Phase 5 morphs glyphs toward the skull alphabet before the hard cut.
#  - Socket flicker, directional dissolve, logo can persist into screensaver
#    (--keep-logo). Rain mix includes @%#*. Timeline flushes every phase.
#  - --seed --no-color --skull-only --logo-only --keep-logo --rain-seconds
#
# v3.0 CHANGELOG
# ------------------------------------------------------------------------------
# NEW
#  - Full-screen ASCII skull, rendered at four resolutions; the engine picks the
#    largest that fits the window. The skull scan-materialises out of the rain,
#    acts as a live backdrop behind the logo, then erodes away leaving the logo
#    glowing. Skull art is strictly ASCII so string lengths are byte-safe in any
#    locale.
#  - The logo is rebuilt from an explicit block font. The old one was a figlet
#    render whose interior whitespace had been collapsed: rows were ragged and
#    it was genuinely unreadable. It is now ~5x larger, every row is exactly the
#    same width, and it has three responsive layouts (wide single line / stacked
#    / medium) plus a plain-text fallback for tiny windows.
#  - Logo is drawn with per-run transparency: unlit cells let the skull show
#    through instead of punching a rectangular hole in it.
#
# CORRECTNESS FIXES
#  - printf "%b" -> printf '%s' everywhere dynamic text is printed. All colour
#    codes are already literal ESC bytes via $'\033', so %b bought nothing and
#    actively corrupted output: %b interprets backslash escapes in the DATA, and
#    the ASCII glyph set contains a literal backslash, so a rain frame could
#    swallow the following character.
#  - SPACE never paused the screensaver. `read -r -n 1 key` strips IFS
#    whitespace, so pressing space yielded an empty string that failed the
#    `[[ -n "$key" ]]` guard. Now `IFS= read -r -n 1`.
#  - `--speed` as the final argument caused an infinite loop: `shift 2` with one
#    argument left fails and shifts nothing, so the while loop span forever.
#    Options that take a value now check `$# -ge 2`.
#  - `--help` printed into the alternate screen buffer and then exited, wiping
#    the help text before the user could read it. Argument parsing now happens
#    before any terminal takeover.
#  - Pressing Q called abl_cleanup, which returns (rather than exits) when the
#    script is sourced - so in sourced mode the rain loop just kept going.
#    Quitting now sets a flag and breaks the loop.
#  - Terminal state is saved with `stty -g` and restored exactly, instead of
#    being flattened with `stty sane` (which discarded the user's own settings).
#
# TIMING / PERFORMANCE
#  - abl_safe_sleep had an operator-precedence bug: `sleep ... || cond && read
#    ... || true` parses as `((sleep || cond) && read) || true`, so `read -t`
#    fired after every successful sleep and silently doubled every delay in the
#    script. Timing is now integer milliseconds with pure-bash arithmetic.
#  - The old sleep cache was keyed on strings like "0.010" but callers passed
#    "0.01", so nearly every call missed the cache and forked awk. awk is now
#    gone from all animation paths entirely.
#  - Rain column reactivation rescanned the whole column array per candidate
#    column - O(n^2) per frame. Now an incrementally maintained counter, O(1).
#
# ROBUSTNESS
#  - 256-colour support is detected, with a basic 8/16-colour fallback.
#  - UTF-8 support is detected; without it the engine falls back to ASCII glyphs
#    and an ASCII logo fill, so nothing turns into mojibake. LC_ALL is only
#    overridden if the locale actually exists (no more setlocale warnings).
#  - SIGTSTP/SIGCONT are handled, so Ctrl-Z then `fg` no longer strands the
#    shell in raw mode inside the alternate screen buffer.
#  - Terminal resize now takes effect immediately inside the screensaver loop.
#  - Removed the dead `--grid-output` flag; help text matches the real options.
# ==============================================================================

# ==============================================================================
# SOURCE GUARD
# ==============================================================================
_ABL_IS_SOURCED=0
[[ "${BASH_SOURCE[0]:-$0}" != "$0" ]] && _ABL_IS_SOURCED=1

_ABL_BASH_MAJOR="${BASH_VERSINFO[0]:-3}"
_ABL_SAVED_LC_ALL="${LC_ALL+set}"
_ABL_SAVED_LC_ALL_VAL="${LC_ALL:-}"
_ABL_SAVED_STTY=""

ABL_ESC=$'\033'
ABL_C_RESET="${ABL_ESC}[0m"
ABL_QUIT=0
ABL_W=80
ABL_H=24
ABL_TRAIL_CAP=22
ABL_SPEED_PCT=50
ABL_USE_KATAKANA=1
ABL_COLUMNS_INITIALIZED=0
ABL_T0=0
_ABL_TERMINAL_UP=0
ABL_NUM_ASCII=1
ABL_NUM_KATAKANA=1

# Colour slots and dual-spectrum palette system (Green Matrix & Electric Blue)
# Maps directly to CSS tokens in the web design system.
ABL_SPECTRUM="green"
ABL_TRUECOLOR=0

ABL_C_WHITE_PEAK=""
ABL_C_NEON=""
ABL_C_BRIGHT=""
ABL_C_MID=""
ABL_C_DEEP=""

# Active skull tier tokens (~1..~4 in ASCII skull art)
ABL_C_SKULL_1=""
ABL_C_SKULL_2=""
ABL_C_SKULL_3=""
ABL_C_SKULL_4=""

# Active rain cascade tokens (head -> t1 -> t2 -> t3 -> t4)
ABL_C_RAIN_HEAD=""
ABL_C_RAIN_T1=""
ABL_C_RAIN_T2=""
ABL_C_RAIN_T3=""
ABL_C_RAIN_T4=""

# Legacy compatibility slots
ABL_C_GREEN_NEON=""
ABL_C_GREEN_BRIGHT=""
ABL_C_GREEN_MID=""
ABL_C_GREEN_DARK=""
ABL_C_BLUE_NEON=""
ABL_C_BLUE_BRIGHT=""
ABL_C_BLUE_MID=""
ABL_C_BLUE_DARK=""

ABL_NO_COLOR=0
ABL_KEEP_LOGO=0
ABL_SKULL_ONLY=0
ABL_LOGO_ONLY=0
ABL_SEED=""
ABL_RAIN_SECONDS=0
ABL_LAYOUT_NAME="unset"
ABL_NCOLORS=8
ABL_WORLD_BLUE=0
ABL_BG=""

# Set active spectrum: "green" or "blue".
# silent: 1 = suppress full-screen transition, 0 = render centered shift stamp.
abl_set_spectrum() {
  local target="${1:-green}"
  local silent="${2:-1}"
  local prev="${ABL_SPECTRUM:-green}"
  ABL_SPECTRUM="$target"

  if [[ "$target" == "blue" ]]; then
    ABL_WORLD_BLUE=1
  else
    ABL_WORLD_BLUE=0
  fi

  if (( ABL_NO_COLOR )); then
    ABL_C_WHITE_PEAK=""
    ABL_C_NEON=""
    ABL_C_BRIGHT=""
    ABL_C_MID=""
    ABL_C_DEEP=""
    ABL_C_SKULL_1=""
    ABL_C_SKULL_2=""
    ABL_C_SKULL_3=""
    ABL_C_SKULL_4=""
    ABL_C_RAIN_HEAD=""
    ABL_C_RAIN_T1=""
    ABL_C_RAIN_T2=""
    ABL_C_RAIN_T3=""
    ABL_C_RAIN_T4=""
    ABL_BG=""
    ABL_C_RESET="${ABL_ESC}[0m"
  elif (( ABL_TRUECOLOR )); then
    # 24-bit TrueColor escapes matching exact hex tokens from the web UI
    if [[ "$target" == "blue" ]]; then
      # Electric Blue: neon #00e5ff, bright #00afd7, mid #005fff, deep #0a5f87, bg #020610
      ABL_C_WHITE_PEAK="${ABL_ESC}[38;2;255;255;255;1m"
      ABL_C_NEON="${ABL_ESC}[38;2;0;229;255;1m"
      ABL_C_BRIGHT="${ABL_ESC}[38;2;0;175;215m"
      ABL_C_MID="${ABL_ESC}[38;2;0;95;255m"
      ABL_C_DEEP="${ABL_ESC}[38;2;10;95;135m"
      # Skull tiers: sk1 #0a4a66, sk2 #1e8fc4, sk3 #63d6f7, sk4 #00ffff
      ABL_C_SKULL_1="${ABL_ESC}[38;2;10;74;102m"
      ABL_C_SKULL_2="${ABL_ESC}[38;2;30;143;196m"
      ABL_C_SKULL_3="${ABL_ESC}[38;2;99;214;247m"
      ABL_C_SKULL_4="${ABL_ESC}[38;2;0;255;255m"
      # Rain tiers: head #d9fbff, t1 #00e5ff, t2 #00c0e0, t3 #005fff, t4 #005f87
      ABL_C_RAIN_HEAD="${ABL_ESC}[38;2;217;251;255;1m"
      ABL_C_RAIN_T1="${ABL_ESC}[38;2;0;229;255m"
      ABL_C_RAIN_T2="${ABL_ESC}[38;2;0;192;224m"
      ABL_C_RAIN_T3="${ABL_ESC}[38;2;0;95;255m"
      ABL_C_RAIN_T4="${ABL_ESC}[38;2;0;95;135m"
      ABL_BG="${ABL_ESC}[48;2;2;6;16m"
    else
      # Green Matrix: neon #5fff5f, bright #00ff00, mid #00af00, deep #0a6e2a, bg #020804
      ABL_C_WHITE_PEAK="${ABL_ESC}[38;2;255;255;255;1m"
      ABL_C_NEON="${ABL_ESC}[38;2;95;255;95;1m"
      ABL_C_BRIGHT="${ABL_ESC}[38;2;0;255;0m"
      ABL_C_MID="${ABL_ESC}[38;2;0;175;0m"
      ABL_C_DEEP="${ABL_ESC}[38;2;10;110;42m"
      # Skull tiers: sk1 #0d5c26, sk2 #22b45a, sk3 #7dffa8, sk4 #00c8ff
      ABL_C_SKULL_1="${ABL_ESC}[38;2;13;92;38m"
      ABL_C_SKULL_2="${ABL_ESC}[38;2;34;180;90m"
      ABL_C_SKULL_3="${ABL_ESC}[38;2;125;255;168m"
      ABL_C_SKULL_4="${ABL_ESC}[38;2;0;200;255m"
      # Rain tiers: head #d6ffd6, t1 #5fff5f, t2 #00ff00, t3 #00af00, t4 #005f00
      ABL_C_RAIN_HEAD="${ABL_ESC}[38;2;214;255;214;1m"
      ABL_C_RAIN_T1="${ABL_ESC}[38;2;95;255;95m"
      ABL_C_RAIN_T2="${ABL_ESC}[38;2;0;255;0m"
      ABL_C_RAIN_T3="${ABL_ESC}[38;2;0;175;0m"
      ABL_C_RAIN_T4="${ABL_ESC}[38;2;0;95;0m"
      ABL_BG="${ABL_ESC}[48;2;2;8;4m"
    fi
    ABL_C_RESET="${ABL_ESC}[0m${ABL_BG}"
  elif (( ABL_NCOLORS >= 256 )); then
    if [[ "$target" == "blue" ]]; then
      ABL_C_WHITE_PEAK="${ABL_ESC}[38;5;231;1m"
      ABL_C_NEON="${ABL_ESC}[38;5;51;1m"
      ABL_C_BRIGHT="${ABL_ESC}[38;5;39m"
      ABL_C_MID="${ABL_ESC}[38;5;27m"
      ABL_C_DEEP="${ABL_ESC}[38;5;24m"
      ABL_C_SKULL_1="${ABL_ESC}[38;5;24m"
      ABL_C_SKULL_2="${ABL_ESC}[38;5;31m"
      ABL_C_SKULL_3="${ABL_ESC}[38;5;81m"
      ABL_C_SKULL_4="${ABL_ESC}[38;5;51m"
      ABL_C_RAIN_HEAD="${ABL_ESC}[38;5;195;1m"
      ABL_C_RAIN_T1="${ABL_ESC}[38;5;51m"
      ABL_C_RAIN_T2="${ABL_ESC}[38;5;39m"
      ABL_C_RAIN_T3="${ABL_ESC}[38;5;27m"
      ABL_C_RAIN_T4="${ABL_ESC}[38;5;24m"
      ABL_BG="${ABL_ESC}[48;5;17m"
    else
      ABL_C_WHITE_PEAK="${ABL_ESC}[38;5;231;1m"
      ABL_C_NEON="${ABL_ESC}[38;5;83;1m"
      ABL_C_BRIGHT="${ABL_ESC}[38;5;46m"
      ABL_C_MID="${ABL_ESC}[38;5;34m"
      ABL_C_DEEP="${ABL_ESC}[38;5;28m"
      ABL_C_SKULL_1="${ABL_ESC}[38;5;22m"
      ABL_C_SKULL_2="${ABL_ESC}[38;5;35m"
      ABL_C_SKULL_3="${ABL_ESC}[38;5;121m"
      ABL_C_SKULL_4="${ABL_ESC}[38;5;45m"
      ABL_C_RAIN_HEAD="${ABL_ESC}[38;5;194;1m"
      ABL_C_RAIN_T1="${ABL_ESC}[38;5;83m"
      ABL_C_RAIN_T2="${ABL_ESC}[38;5;46m"
      ABL_C_RAIN_T3="${ABL_ESC}[38;5;34m"
      ABL_C_RAIN_T4="${ABL_ESC}[38;5;22m"
      ABL_BG="${ABL_ESC}[48;5;232m"
    fi
    ABL_C_RESET="${ABL_ESC}[0m${ABL_BG}"
  else
    if [[ "$target" == "blue" ]]; then
      ABL_C_WHITE_PEAK="${ABL_ESC}[1;37m"
      ABL_C_NEON="${ABL_ESC}[1;36m"
      ABL_C_BRIGHT="${ABL_ESC}[36m"
      ABL_C_MID="${ABL_ESC}[34m"
      ABL_C_DEEP="${ABL_ESC}[2;34m"
      ABL_C_SKULL_1="${ABL_ESC}[2;34m"
      ABL_C_SKULL_2="${ABL_ESC}[34m"
      ABL_C_SKULL_3="${ABL_ESC}[36m"
      ABL_C_SKULL_4="${ABL_ESC}[1;36m"
      ABL_C_RAIN_HEAD="${ABL_ESC}[1;37m"
      ABL_C_RAIN_T1="${ABL_ESC}[1;36m"
      ABL_C_RAIN_T2="${ABL_ESC}[36m"
      ABL_C_RAIN_T3="${ABL_ESC}[34m"
      ABL_C_RAIN_T4="${ABL_ESC}[2;34m"
    else
      ABL_C_WHITE_PEAK="${ABL_ESC}[1;37m"
      ABL_C_NEON="${ABL_ESC}[1;32m"
      ABL_C_BRIGHT="${ABL_ESC}[1;32m"
      ABL_C_MID="${ABL_ESC}[32m"
      ABL_C_DEEP="${ABL_ESC}[2;32m"
      ABL_C_SKULL_1="${ABL_ESC}[2;32m"
      ABL_C_SKULL_2="${ABL_ESC}[32m"
      ABL_C_SKULL_3="${ABL_ESC}[1;32m"
      ABL_C_SKULL_4="${ABL_ESC}[1;36m"
      ABL_C_RAIN_HEAD="${ABL_ESC}[1;37m"
      ABL_C_RAIN_T1="${ABL_ESC}[1;32m"
      ABL_C_RAIN_T2="${ABL_ESC}[32m"
      ABL_C_RAIN_T3="${ABL_ESC}[32m"
      ABL_C_RAIN_T4="${ABL_ESC}[2;32m"
    fi
    ABL_BG=""
    ABL_C_RESET="${ABL_ESC}[0m"
  fi

  # Mirror legacy aliases so existing phase logic seamlessly uses active spectrum
  ABL_C_GREEN_NEON="$ABL_C_NEON"
  ABL_C_GREEN_BRIGHT="$ABL_C_BRIGHT"
  ABL_C_GREEN_MID="$ABL_C_MID"
  ABL_C_GREEN_DARK="$ABL_C_DEEP"

  # Also retain specific references
  if [[ "$target" == "blue" ]]; then
    ABL_C_BLUE_NEON="$ABL_C_NEON"
    ABL_C_BLUE_BRIGHT="$ABL_C_BRIGHT"
    ABL_C_BLUE_MID="$ABL_C_MID"
    ABL_C_BLUE_DARK="$ABL_C_DEEP"
  fi

  # Re-prepare skull art if loaded
  if (( ${#_ABL_SKULL_SRC[@]} > 0 )); then
    abl_prepare_art
  fi

  if (( silent == 0 )); then
    printf '%s' "${ABL_ESC}[0m${ABL_BG}${ABL_ESC}[2J${ABL_ESC}[H"
    local upFrom="GREEN" upTo="BLUE"
    if [[ "$target" == "green" ]]; then upFrom="BLUE"; upTo="GREEN"; fi
    abl_write_centered "[ SPECTRUM SHIFT: $upFrom -> $upTo ]" $(( ABL_H / 2 )) "$ABL_C_NEON"
    abl_write_centered "[ RAIN VECTOR RECOLOURED ]" $(( ABL_H / 2 + 2 )) "$ABL_C_BRIGHT"
    abl_sleep_ms 450
    printf '%s' "${ABL_BG}${ABL_ESC}[2J${ABL_ESC}[H"
  fi
}

abl_detect_color_support() {
  local ncolors
  ncolors=$(tput colors 2>/dev/null)
  [[ "$ncolors" =~ ^[0-9]+$ ]] || ncolors=8
  ABL_NCOLORS=$ncolors

  # Detect 24-bit TrueColor capability
  ABL_TRUECOLOR=0
  if [[ "${COLORTERM:-}" =~ ^(truecolor|24bit)$ ]] || \
     [[ "${TERM_PROGRAM:-}" =~ ^(iTerm\.app|Apple_Terminal|WezTerm|ghostty|vscode)$ ]] || \
     [[ "${TERM:-}" =~ ^(xterm-direct|xterm-ghostty|kitty|alacritty)$ ]]; then
    ABL_TRUECOLOR=1
  fi

  # Initialize palette using selected spectrum
  abl_set_spectrum "$ABL_SPECTRUM" 1
}

# Shift to blue world (Phase 2 -> Phase 2b transition)
abl_shift_to_blue_world() {
  local silent="${1:-0}"
  abl_set_spectrum "blue" "$silent"
}

# Shift to green world
abl_shift_to_green_world() {
  local silent="${1:-0}"
  abl_set_spectrum "green" "$silent"
}

# Dynamic toggle during interactive loops
abl_shift_spectrum() {
  local to="$1"
  local silent="${2:-1}"
  abl_set_spectrum "$to" "$silent"
}

# 10 wall-clock seconds of live rain: green columns ignite cyan then lock blue.
# Diagonal shock front + stray early-converted columns. Does not use ABL_SPEED
# for the 10s cap — first ten real seconds of rain are the convert.
abl_spectrum_shift_sequence() {
  local t0 elapsed pct front x t ty headY len tailY score edge color FRAME_BUFFER span hud vx vy dx _ABL_G
  local gH gB gM gD bH bB bM bD shock
  if (( ABL_TRUECOLOR )); then
    gH="${ABL_ESC}[38;2;95;255;95;1m"; gB="${ABL_ESC}[38;2;0;255;0m"; gM="${ABL_ESC}[38;2;0;175;0m"; gD="${ABL_ESC}[38;2;10;110;42m"
    bH="${ABL_ESC}[38;2;0;229;255;1m"; bB="${ABL_ESC}[38;2;0;175;215m"; bM="${ABL_ESC}[38;2;0;95;255m"; bD="${ABL_ESC}[38;2;10;95;135m"
    shock="${ABL_ESC}[38;2;255;255;255;1m"
  elif (( ABL_NCOLORS >= 256 )); then
    gH="${ABL_ESC}[38;5;83;1m"; gB="${ABL_ESC}[38;5;46m"; gM="${ABL_ESC}[38;5;34m"; gD="${ABL_ESC}[38;5;28m"
    bH="${ABL_ESC}[38;5;51;1m"; bB="${ABL_ESC}[38;5;39m"; bM="${ABL_ESC}[38;5;27m"; bD="${ABL_ESC}[38;5;24m"
    shock="${ABL_ESC}[38;5;231;1m"
  else
    gH="${ABL_ESC}[1;32m"; gB="${ABL_ESC}[1;32m"; gM="${ABL_ESC}[32m"; gD="${ABL_ESC}[2;32m"
    bH="${ABL_ESC}[1;36m"; bB="${ABL_ESC}[36m"; bM="${ABL_ESC}[34m"; bD="${ABL_ESC}[2;34m"
    shock="${ABL_ESC}[1;37m"
  fi

  (( ABL_NUM_ASCII < 1 )) && ABL_NUM_ASCII=1
  (( ABL_NUM_KATAKANA < 1 )) && ABL_NUM_KATAKANA=1
  (( ABL_TRAIL_CAP < 4 )) && ABL_TRAIL_CAP=22
  abl_init_rain_columns
  printf '%s' "${ABL_ESC}[2J${ABL_ESC}[H"
  span=$(( ABL_H - 6 ))
  (( span < 8 )) && span=8
  t0=$SECONDS
  # per-column horizontal offset. identity stays the array index.
  for (( x = 1; x <= ABL_W; x++ )); do
    ABL_col_xoff[$x]=0
  done

  while :; do
    elapsed=$(( SECONDS - t0 ))
    (( elapsed >= 10 )) && break
    pct=$(( elapsed * 100 / 10 ))
    (( pct > 100 )) && pct=100
    front=$(( (ABL_W + ABL_H) * pct / 100 ))

    FRAME_BUFFER=""
    for (( x = 1; x <= ABL_W; x++ )); do
      if (( ABL_col_active[x] == 0 )); then
        if (( RANDOM % 100 < 6 )); then
          ABL_col_active[$x]=1
          ABL_col_y[$x]=$(( -(RANDOM % 4) ))
          ABL_col_xoff[$x]=0
        else
          continue
        fi
      fi
      headY=${ABL_col_y[$x]}
      len=${ABL_col_len[$x]}
      (( len > ABL_TRAIL_CAP )) && len=$ABL_TRAIL_CAP

      # field at the head: same scalar used for colour
      score=$(( x + headY / 2 ))
      edge=$(( score - front ))
      vx=0
      vy=${ABL_col_speed[$x]}
      if (( edge < -4 )); then
        vy=$(( vy + 1 ))
        # relax lean once locked blue
        if (( ABL_col_xoff[x] > 0 )); then vx=-1
        elif (( ABL_col_xoff[x] < 0 )); then vx=1
        fi
      elif (( edge <= 4 )); then
        vy=$(( vy + 2 ))
        vx=1
      fi
      ABL_col_xoff[$x]=$(( ABL_col_xoff[x] + vx ))
      (( ABL_col_xoff[x] > 6 )) && ABL_col_xoff[$x]=6
      (( ABL_col_xoff[x] < -3 )) && ABL_col_xoff[$x]=-3
      dx=$(( x + ABL_col_xoff[x] ))
      (( dx < 1 )) && dx=1
      (( dx > ABL_W )) && dx=$ABL_W

      for (( t = 0; t <= len; t++ )); do
        ty=$(( headY - t ))
        (( ty < 1 || ty > ABL_H - 1 )) && continue
        score=$(( x + ty / 2 ))
        edge=$(( score - front ))
        _ABL_G="${ABL_USE_KATAKANA:+${ABL_GLYPHS_KATAKANA[RANDOM%ABL_NUM_KATAKANA]}}"; : "${_ABL_G:=${ABL_GLYPHS_ASCII[RANDOM%ABL_NUM_ASCII]}}"
        if (( edge < -4 )); then
          if (( t == 0 )); then color="$bH"
          elif (( t < 3 )); then color="$bB"
          elif (( t < 8 )); then color="$bM"
          else color="$bD"; fi
        elif (( edge <= 4 )); then
          if (( t == 0 )); then color="$shock"
          elif (( t < 3 )); then color="$bH"
          else color="$bB"; fi
        else
          if (( t == 0 )); then color="$gH"
          elif (( t < 3 )); then color="$gB"
          elif (( t < 8 )); then color="$gM"
          else color="$gD"; fi
        fi
        FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${ty};${dx}H${color}${_ABL_G}"
      done

      tailY=$(( headY - len ))
      if (( tailY >= 1 && tailY <= ABL_H - 1 )); then
        FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${tailY};${dx}H "
      fi
      ABL_col_y[$x]=$(( ABL_col_y[$x] + vy ))
      if (( ABL_col_y[$x] - len > ABL_H )); then
        ABL_col_y[$x]=$(( -(RANDOM % 8) ))
        ABL_col_speed[$x]=$(( (RANDOM % 3) + 1 ))
        ABL_col_len[$x]=$(( (RANDOM % span) + 8 ))
        ABL_col_xoff[$x]=0
      fi
    done

    hud="[ SPECTRUM SHIFT  ${pct}%  GREEN -> BLUE ]"
    FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${ABL_H};1H${ABL_ESC}[2K${ABL_C_WHITE_PEAK}${hud}"
    printf '%s' "${FRAME_BUFFER}${ABL_C_RESET}"
    # tight frames; 10s cap is wall-clock via SECONDS, not this delay
    abl_sleep_ms 16
  done

  abl_shift_to_blue_world 1
}

# --- Locale / UTF-8 -----------------------------------------------------------
# Only override LC_ALL when the target locale genuinely exists, otherwise bash
# emits a setlocale warning on every start.
ABL_UTF8=1
ABL_BLOCK="#"

abl_setup_locale() {
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]*)
      ABL_UTF8=1
      ;;
    *)
      if command -v locale >/dev/null 2>&1 &&
         locale -a 2>/dev/null | grep -qi '^en_US\.utf-*8$'; then
        export LC_ALL="en_US.UTF-8"
        ABL_UTF8=1
      else
        ABL_UTF8=0
      fi
      ;;
  esac

  if (( ABL_UTF8 )); then
    # U+2588 FULL BLOCK written as raw UTF-8 bytes: bash 3.2 (macOS default)
    # has no \u escape, but \x has been supported since 2.x.
    ABL_BLOCK=$'\xe2\x96\x88'
  else
    ABL_BLOCK="#"
    ABL_USE_KATAKANA=0
  fi
}

# --- Terminal geometry --------------------------------------------------------
abl_get_term_size() {
  local cols lines
  cols=$(tput cols 2>/dev/null)
  lines=$(tput lines 2>/dev/null)
  [[ "$cols" =~ ^[0-9]+$ ]] && ABL_W=$cols || ABL_W=80
  [[ "$lines" =~ ^[0-9]+$ ]] && ABL_H=$lines || ABL_H=24
  (( ABL_W < 40 )) && ABL_W=40
  (( ABL_H < 10 )) && ABL_H=10
}

# --- Terminal setup / teardown ------------------------------------------------
abl_init_terminal() {
  if [[ -t 0 ]]; then
    _ABL_SAVED_STTY=$(stty -g 2>/dev/null) || _ABL_SAVED_STTY=""
  fi
  printf '%s' "${ABL_ESC}[?1049h${ABL_ESC}[?25l${ABL_ESC}[?7l"
  if [[ -t 0 ]]; then
    stty -echo -icanon min 0 time 0 2>/dev/null || true
  fi
  _ABL_TERMINAL_UP=1
}

abl_restore_terminal() {
  (( _ABL_TERMINAL_UP == 1 )) || return 0
  printf '%s' "${ABL_ESC}[0m${ABL_ESC}[?7h${ABL_ESC}[?25h${ABL_ESC}[?1049l"
  if [[ -n "$_ABL_SAVED_STTY" ]]; then
    stty "$_ABL_SAVED_STTY" 2>/dev/null || stty sane 2>/dev/null || true
  elif [[ -t 0 ]]; then
    stty sane 2>/dev/null || true
  fi
  _ABL_TERMINAL_UP=0
}

abl_cleanup() {
  trap - INT TERM EXIT WINCH TSTP CONT
  abl_restore_terminal
  if [[ "$_ABL_SAVED_LC_ALL" == "set" ]]; then
    export LC_ALL="$_ABL_SAVED_LC_ALL_VAL"
  else
    unset LC_ALL
  fi
  (( _ABL_IS_SOURCED )) && return 0
  exit 0
}

abl_resize_handler() {
  abl_get_term_size
  ABL_COLUMNS_INITIALIZED=0
}

abl_suspend_handler() {
  abl_restore_terminal
  trap - TSTP
  kill -TSTP "$$"
}

abl_resume_handler() {
  printf '%s' "${ABL_ESC}[?1049h${ABL_ESC}[?25l${ABL_ESC}[?7l"
  [[ -t 0 ]] && stty -echo -icanon min 0 time 0 2>/dev/null
  _ABL_TERMINAL_UP=1
  trap abl_suspend_handler TSTP
  abl_get_term_size
  ABL_COLUMNS_INITIALIZED=0
}

# ==============================================================================
# TIMING - integer milliseconds, pure bash, no awk in any animation path
# ==============================================================================
ABL_SPEED_PCT=50
_ABL_SLEEP_S=""

# "0.5" -> 50, "1" -> 100, "1.25" -> 125
abl_parse_speed() {
  local s="$1" int frac
  int="${s%%.*}"
  frac=""
  case "$s" in *.*) frac="${s#*.}" ;; esac
  [[ -z "$int" ]] && int=0
  frac="${frac}00"
  frac="${frac:0:2}"
  ABL_SPEED_PCT=$(( 10#$int * 100 + 10#$frac ))
  (( ABL_SPEED_PCT < 1 )) && ABL_SPEED_PCT=1
  (( ABL_SPEED_PCT > 2000 )) && ABL_SPEED_PCT=2000
}

# Converts a base millisecond delay into "$_ABL_SLEEP_S", a speed-adjusted
# "S.mmm" string usable by both `sleep` and `read -t`.
abl_ms_to_s() {
  local pct=$ABL_SPEED_PCT
  (( pct < 1 )) && pct=1
  local ms=$(( ${1:-1} * pct / 100 ))
  (( ms < 1 )) && ms=1
  printf -v _ABL_SLEEP_S "%d.%03d" $(( ms / 1000 )) $(( ms % 1000 ))
}

abl_sleep_ms() {
  abl_ms_to_s "$1"
  if ! sleep "$_ABL_SLEEP_S" 2>/dev/null; then
    if (( _ABL_BASH_MAJOR >= 4 )); then
      read -t "$_ABL_SLEEP_S" -r _abl_dummy 2>/dev/null
    fi
  fi
  return 0
}

# ==============================================================================
# TIMELINE ARTIFACTS
# ==============================================================================
ABL_ARTIFACT_ROOT="${ABL_ARTIFACT_ROOT:-${HOME:-/tmp}/.abliterated_ai/artifacts}"
ABL_TIMELINE_KEYS=()
ABL_TIMELINE_VALS=()
ABL_CURRENT_SEC=0

abl_advance_timeline() {
  ABL_CURRENT_SEC=$(( ABL_CURRENT_SEC + 1 ))
  ABL_TIMELINE_KEYS[${#ABL_TIMELINE_KEYS[@]}]="$ABL_CURRENT_SEC"
  ABL_TIMELINE_VALS[${#ABL_TIMELINE_VALS[@]}]="$1"
  abl_post_execution_artifacts
}

abl_post_execution_artifacts() {
  local json="{" first=1 i sec desc
  for (( i = 0; i < ${#ABL_TIMELINE_KEYS[@]}; i++ )); do
    sec="${ABL_TIMELINE_KEYS[$i]}"
    desc="${ABL_TIMELINE_VALS[$i]}"
    desc="${desc//\\/\\\\}"
    desc="${desc//\"/\\\"}"
    (( first == 0 )) && json="${json},"
    json="${json}\"${sec}\": \"${desc}\""
    first=0
  done
  json="${json}}"
  mkdir -p "$ABL_ARTIFACT_ROOT" 2>/dev/null || return 0
  printf '%s\n' "$json" > "${ABL_ARTIFACT_ROOT}/timeline.json" 2>/dev/null || true
}

# ==============================================================================
# GLYPH SETS
# ==============================================================================
ABL_GLYPHS_KATAKANA=(
  "ｦ" "ｧ" "ｨ" "ｩ" "ｪ" "ｫ" "ｬ" "ｭ" "ｮ" "ｯ" "ｰ" "ｱ" "ｲ" "ｳ" "ｴ" "ｵ"
  "ｶ" "ｷ" "ｸ" "ｹ" "ｺ" "ｻ" "ｼ" "ｽ" "ｾ" "ｿ" "ﾀ" "ﾁ" "ﾂ" "ﾃ" "ﾄ" "ﾅ"
  "ﾆ" "ﾇ" "ﾈ" "ﾉ" "ﾊ" "ﾋ" "ﾌ" "ﾍ" "ﾎ" "ﾏ" "ﾐ" "ﾑ" "ﾒ" "ﾓ" "ﾔ" "ﾕ"
  "ﾖ" "ﾗ" "ﾘ" "ﾙ" "ﾚ" "ﾛ" "ﾜ" "ﾝ" "0" "1" "2" "3" "4" "5" "6" "7"
  "8" "9" "A" "B" "C" "D" "E" "F" "@" "#" "$" "%" "*" "+" "=" "<" ">"
  "@" "%" "#" "*" "@" "%" "#"
)
ABL_NUM_KATAKANA=${#ABL_GLYPHS_KATAKANA[@]}

ABL_GLYPHS_ASCII=(
  "A" "B" "C" "D" "E" "F" "G" "H" "I" "J" "K" "L" "M" "N" "O" "P"
  "Q" "R" "S" "T" "U" "V" "W" "X" "Y" "Z" "a" "b" "c" "d" "e" "f"
  "0" "1" "2" "3" "4" "5" "6" "7" "8" "9" "@" "#" "$" "%" "*" "+"
  "=" "-" "~" ":" "." "/" "\\" "<" ">" "|" "{" "}" "[" "]" "!" "?"
)
ABL_NUM_ASCII=${#ABL_GLYPHS_ASCII[@]}
ABL_USE_KATAKANA=1

# Sets _ABL_G to a random glyph from the active set. Inlined-style helper to
# keep the rain loop free of subshells.
abl_rand_glyph() {
  if (( ABL_USE_KATAKANA && ABL_NUM_KATAKANA > 0 )); then
    _ABL_G="${ABL_GLYPHS_KATAKANA[$(( RANDOM % ABL_NUM_KATAKANA ))]}"
  elif (( ABL_NUM_ASCII > 0 )); then
    _ABL_G="${ABL_GLYPHS_ASCII[$(( RANDOM % ABL_NUM_ASCII ))]}"
  else
    _ABL_G="#"
  fi
}

abl_write_centered() {
  local text="$1" y="$2" color="${3:-$ABL_C_GREEN_BRIGHT}"
  local x
  (( y < 1 || y > ABL_H )) && return 0
  x=$(( (ABL_W - ${#text}) / 2 ))
  (( x < 1 )) && x=1
  printf '%s' "${ABL_ESC}[${y};${x}H${color}${text}${ABL_C_RESET}"
}

abl_type_line() {
  local text="$1" color="${2:-$ABL_C_GREEN_BRIGHT}" delay="${3:-5}"
  local c
  printf '%s' "$color"
  for (( c = 0; c < ${#text}; c++ )); do
    printf '%s' "${text:$c:1}"
    abl_sleep_ms "$delay"
  done
  printf '%s\n' "$ABL_C_RESET"
}

# ==============================================================================
# GENERATED ART ASSETS
# ------------------------------------------------------------------------------
# Skull rows encode colour tiers with ~1 / ~2 / ~3 / ~4 markers, substituted
# for ANSI codes at load time. ~4 is the blue particle spray (the attached
# skull's right-hand field, blue not red). '~' never appears in the art charset. Art is pure
# ASCII so ${#row} is byte-safe in any locale.
# Logo rows use '#' for lit cells and '.' for unlit (transparent) cells.
# ==============================================================================

ABL_SKULL_XL=(
 "                                        ~2~4=~4:~4=~4:~4=~4=~4:~4=~4:~4=~4:~4:"
 "                              ~2=+:==+==+:+=::==:====:::==:~1~4=~4:~4:~4=~4="
 "                         ~2===++=+==+===++++=++==++==:==+=:==:=~1~4:~4:~4:~4=~4:~4:"
 "                     ~2=+==++++=+++*==+++++=+++*++++=++++==:=:::::~1~4:~4:~4:~4:~4:~4:~4="
 "                 ~2======+*++==++*++**+*+****+++*+*++**++++===::======~1~4=~4=~4:~4:~4:~4:~4:"
 "               ~2++++++=+***++*+*#**#~3****##*##**~2*++#***+**+++=+===+=====~1~4=~4:~4:~4:~4:~4:~4:"
 "            ~2=+=++++++*+*+***~3*##*#######%##%*###******~2***+**+**=+==++===::~1~4:~4=~4:~4:~4:~4-~4:"
 "          ~2++=++*=++*++*~3##**###**###%%%#%#%###%####******#*~2*++++=++==+=+===:~1~4=~4=~4=~4:~4=~4:~4:"
 "        ~2=====++++***~3***#*##%%%#%#%#%%%%%#%#%##%#%%%%%%##%*##+~2*****=+++++=+==~1~4:~4:~4:~4:~4:~4=~4:~4:"
 "       ~2+++=+++**+*~3***##%%##%%%%%%%%@%@%%%@@@%%%%%@#@%##%%##*#**~2+**+*+++=+=::==~1~4:~4:~4:~4:~4=~4-~4:"
 "     ~2+=++*+++***~3****%#%##%%%@@@@@@@@%@@@@@%@%@%%@@%%%%%###%####**~2*++++++++====:~1~4:~4:~4=~4:~4:~4:~4=~4-"
 "    ~2===+***++*~3#*#*#%%%@%%%@@@@@@@@@@@@@@@@@@%%@@%%@%%%@%%%##%##*##*~2***+=+++=+==:~1~4=~4:~4=~4:~4:~4:~4:~4="
 "   ~2===++*+++#~3***#%%%@@%%@@%@@@@@@@@@@@@@@@@%@@@%%@%%@@###%#%%##%#*#*~2*+**+*===++=:~1~4:~4:~4=~4:~4=~4:~4:~4:"
 "  ~2+==++=+*++~3+#*%%%##%%@@@@@@@@@@@@@@@@@@@@@@@@@%@@@%%@@@####%%%#%#*##~2+**++===+==::~1~4=~4:~4:~4:~4:~4:~4-~4-"
 "  ~2=++==*++*~3#*###%%%%@%%@@@@@@@@@@@@@@@@@@@@@@@%%@@%%@%@%%#%##%%####***~2**+++=+====::~1~4=~4:~4:~4:~4:~4-~4:"
 " ~2==+++++++*~3**#*%#%@%%@@@@@@@@@@@@@@@@@@@@@@@@@@%%@%%%%@%@#%#%%#%###*#*~2**+*++++=+:=:~1~4=~4=~4:~4:~4:~4-~4-~4-"
 " ~2==++=+*++~3***##%#%%%@%%@@@@@@@@@@@@@@@@@@@@%@%@@%%@%%@%%%#%%%#%%###***~2+****+++=+===~1~4=~4:~4=~4-~4:~4:~4:~4:"
 "~2+=+==*+**#~3*##%#%%%%@%@@%@@@@@@@@@@@@@@@@@@@@%%%%@@@@%%##%#########%##*~2+***+++=+=+:::~1~4=~4=~4-~4:~4:~4:~4-~4:"
 "~2=+=+=+*++*~3*#####%%@%@%@@@@@@@@@@@@@@@@@@@@@@%@@%%%@@%#%%%###%%#%*#%##*~2**+++=+++===:=~1~4:~4=~4=~4:~4:~4:~4:~4-"
 "~2+++++++++*~3**####%%%%@@%@@@@@@@@@@@@@@@@@@@@@%@%@%@%#%%#%%%###%%#*##**#~2#***+*++++===:~1~4=~4:~4=~4:~4:~4-~4:~4-"
 "~2:+===++***#~3#*#%%#%%%%@@@%@@@@@@@@@@@@@@@%@@@%@@%%%%#%#%%%%#%#######*#*~2+***+*+++===:~1~4=~4:~4:~4:~4:~4-~4:~4:~4:"
 "~2+=+===+*+*+*~3*##%#%%%%%%%@@@@@@@@@@@%@@@%%%@@@%@@%%%%%%%%####%#%#**###~2**+*++==+=+:=~1~4:~4:~4:~4:~4:~4-~4-~4:~4:~4:"
 " ~2=:===+=++++*~3#*###%%#%%%@%@%@@%%@@@@%%@@@%@@@%%%@%%%%%#######*###*~2*****++++=++===~1~4:~4:~4:~4:~4:~4:~4-~4:~4:~4-"
 " ~2=========+++**~3**##          #%@%%%%%%@@%%%@%@%%@#######%###***          ~2=+====~1~4=~4:~4:~4-~4:~4:~4-~4-~4-~4-~4:~4:"
 "  ~1=:===~2=::+++++                   ~3%#%%#%%%#%#%##%#%%%*#*##                   ~1~4:~4:~4:~4:~4:~4:~4-~4-~4.~4-~4-~4.~4:"
 "   ~1::::=::=~2:                         ~3%#%#%%#%####%%%**#                         ~1~4.~4-~4-~4:~4.~4-~4.~4.~4."
 "    ~1::-::-                             ~3###%%###%##*##                             ~1~4-~4.~4.~4.~4-~4."
 "     ~1:-:-                               ~3%%#*%#%#*#**                               ~1~4.~4.~4.~4."
 "     ~1---:                                ~3######*##*                                ~1~4.~4.~4.~4."
 "    ~1=----                                ~3#**#**##*~2*                                ~1~4.~4-~4-~4.~4."
 "    ~1::--:                                 ~3*##*##*#                                 ~1~4-~4.~4.~4-~4-"
 "     ~1:=::                                 ~3***#####                                 ~1~4.~4-~4-~4:"
 "     ~1:::::                               ~3**#**###*~2#                               ~1~4:~4:~4.~4-~4-"
 "       ~1=::=                             ~3#*###**#**#~2*                             ~1~4-~4-~4-~4-"
 "        ~2:~1:::~2:                          ~3**##      #**~2*                          ~1~4:~4-~4-~4:~4-"
 "         ~2:::==+                      ~3**#*#        **#~2**                      ~1~4:~4-~4:~4:~4-~4-"
 "        ~2==:=++=++**              ~3#########        #*#+~2*****              +++=:~1~4:~4:~4:~4:~4-~4:"
 "        ~2===++++++*~3**##%%%##%**#####%####            ***#~2**+****##***#+**++++=:~1~4=~4=~4=~4=~4:~4-"
 "         ~2::====+*+#~3***###*#%########%##              **#*~2+*****++***+++=*+===~1~4:~4=~4:~4=~4:~4:"
 "         ~2::===++++**#*~3*#**###**#*%##*#                **~2++#**++++*++*==+====~1~4:~4:~4:~4:~4:~4-~4:"
 "          ~2=:=:==++++++*+**~3*#*##*#**#*#                *~2****+*++*++++++==:~1~4=~4=~4:~4:~4:~4:~4-~4:~4-"
 "            ~2=::+======+++**~3*###*###*##**  ##**  *#*# #~2+*****+*+*++++=:=~1~4:~4:~4=~4-~4:~4-~4:~4:~4-"
 "              ~2=======++++**~3** ####* #*#*  ###*  #**# ~2#+**  ++++ ++====:~1~4:~4-~4=~4:~4-~4:~4:"
 "               ~1=~2:=====+  **#~3# ****# #**#  ##*#  ##** ~2#***  **++  +++==~1~4=~4:~4:~4-~4-~4:~4-"
 "                ~1=~2:=+:==  +*+* ~3##**# #***  ###*  ***~2* *+**  ****  +==:~1~4=~4:~4:~4:~4:~4:~4:"
 "                 ~1::~2=::=                                              ~1~4:~4-~4:~4:~4:~4-"
 "                   ~1==~2=:  =*++ #~3**#* ##*#  ****  *+~2*# ***+  **++  =:~1~4=~4:~4:~4-~4:~4-"
 "                   ~1::~2:=  =+** ~3##### #*#*  ###*  *~2*#* +*+*  *+*+  =:~1~4:~4=~4:~4-~4-~4-"
 "                   ~1=:~2=====*+**#~3***# ##**  ##**  ~2*#*# *+*+  **======~1~4:~4-~4:~4:~4-~4-"
 "                   ~1=::~2===+=++*#~3+*#####**###**#*~2*****+**#*++++==+===~1~4:~4:~4-~4-~4-~4:"
 "                    ~1:=~2:====+*+**#~3+*#*****#****~2#***#*+**++++*++====~1~4:~4:~4:~4-~4-~4-"
 "                     ~1=:=~2====++*+***+*~3*#*#****~2********+**++++=:==~1~4=~4:~4=~4-~4:~4-~4-"
 "                       ~1::=~2=:+===+*++*+********+*+*+*+++*++====~1~4:~4:~4=~4:~4-~4:~4-"
 "                         ~1::==~2:=+===+=++++*+*+**+**+==+=+==:~1~4:~4=~4:~4:~4=~4:~4:~4:"
 "                           ~1-:==:=~2:=::+=+=====+=+====+=:~1~4=~4=~4=~4:~4:~4:~4-~4-~4:~4-"
 "                               ~1~4:~4:~4-~4:~4:~4:~4:~4=~4=~4=~4=~4:~4:~4:~4=~4:~4:~4:~4:~4=~4-~4:~4=~4:~4:~4:~4-~4-~4-~4:"
 "                                     ~1~4:~4=~4-~4:~4:~4:~4:~4:~4=~4-~4:~4:~4:~4:~4=~4-~4:~4:"
)
ABL_SKULL_XL_W=92
ABL_SKULL_XL_H=57

ABL_SKULL_LARGE=(
 "                             ~2=:=:==:=:=:~1~4:"
 "                     ~2=+===+==+:+==:==:====:::~1~4=~4:~4:~4="
 "                ~2==++=++++=*=++=+=++++=++==++==:=~1~4=~4=~4=~4:~4:~4="
 "             ~2=====+=++*++****+*+**+++++++=+=++====:=~1~4=~4=~4=~4:~4:"
 "          ~2=+====+++++*+#~3******##******~2#++**++=++++==:=~1~4=~4=~4:~4:~4=~4="
 "        ~2+++++++++**~3####%%#####%%%##%*####**~2****++++==:+=~1~4:~4=~4=~4:~4:~4:"
 "      ~2==+++*+**~3****####%%%%@%@%%%#%##%##%#####~2+*+++++++===~1~4=~4=~4:~4:~4:~4="
 "     ~2+++++**+~3***##%%@%@@%@@%@@@@@%%%%%%%#%#*###*#~2**++=+====~1~4=~4:~4:~4=~4:~4:"
 "    ~2==+++**~3#*#*%%%%@%%@@%@%@@@@@@%@%%%@%%%%#%###**~2*#+*++==:::~1~4=~4:~4:~4-~4:"
 "   ~2+++++*+~3**%%%#@%%%@@@@@@@@@@@@@@@@@@@%%@#%%#%%###*~2***++++==:~1~4:~4:~4:~4-~4:"
 "  ~2++++++*~3###%#%%%%@@@@@@@@@@@@@@@@@%%%@@@%%%%#%#%%**~2##++++==:=~1~4=~4:~4=~4:~4=~4:"
 " ~2=++==+*~3**##%#@@%@@@@@@@@@@@@@@@@@@@%%@@@%@@%%#%###**~2#++++++==:~1~4=~4:~4:~4-~4-~4:"
 " ~2==+*+++~3***##%@@@@@@@@@@@@@@@@@@@@@@%%@@%%#%%%%%#**##~2#***++=+==~1~4=~4:~4:~4:~4:~4:"
 "~2==++++*+~3*#%%%%%%@@@@@@@@@@@@@@@@@@@%@%@%%%%%%####%***#~2+++++++++~1~4:~4:~4=~4:~4-~4:~4:"
 "~2====++*+~3#*#%%%%@@@@@@@@@@@@@@@@@@%@@%@%%#%%%%###%%#**~2**+*+++===:~1~4=~4:~4:~4:~4-~4-"
 "~2:==+**++~3*####%%@@@@%@@@@@@@@%@@@@@@%@%@#%%%%####%##*#~2*+**=++==:~1~4:~4:~4:~4:~4-~4-~4-"
 "~2====++=+*~3*#*#%%%%@%@@@@@@%@%%@@@%@%%#%%%#%######*###~2++**+=+=+=~1~4=~4:~4:~4-~4:~4:~4:~4-"
 " ~2:=====+*+*~3#*%#%%%%%%%%%%%@%%@@%%%##%#%%#%####***~2#+****=++++:~1~4=~4=~4-~4-~4:~4-~4:~4-"
 " ~1=::=:~2:===+               ~3#@%@%@#%%%%%%%#%#*               ~1~4=~4:~4:~4:~4-~4:~4-~4.~4-~4."
 "  ~1=::=:::                   ~3###%%%%##%****                   ~1~4-~4.~4-~4-~4.~4-~4-"
 "   ~1-:---                      ~3#%%#####*#                      ~1~4.~4-~4.~4.~4-"
 "    ~1---                        ~3**#*#%**                        ~1~4.~4.~4."
 "   ~1:---                         ~3*###*#                         ~1~4-~4.~4-~4-"
 "   ~1:---                         ~3*####*                         ~1~4-~4.~4-~4-"
 "    ~1::=                        ~3*#***##~2*                        ~1~4-~4-~4-"
 "     ~1:===                      ~3######**                      ~1~4-~4-~4-~4-"
 "       ~1:~2=::                  ~3*#**    ***~2*                  ~1~4:~4:~4-~4:"
 "       ~2=+++=**            ~3#****#      ###~2**+            ==:~1~4:~4:~4-~4-"
 "       ~2:==+***~3**##%#%###*#***##        ***#~2*****#*+**++=++==~1~4:~4:~4-"
 "       ~2=:+==+**~3*#*##%%###*###*          *#*~2**#*****+++++==~1~4:~4=~4:~4-~4:"
 "        ~2:=+++++*++*~3+*#####*##            #~2#****+**++++==~1~4:~4:~4-~4:~4:~4:"
 "         ~2=:====+*+**~3**#*#*# ##* ### **#  ~2**#****+*====~1~4:~4:~4:~4:~4:~4-~4-"
 "           ~1=~2===++++*#~3# ##*  #*# ##* ***  ~2#*# +*+ +===:~1~4:~4:~4:~4:~4:"
 "            ~1=~2:++=+ **+ ~3##*  *## *** *#*  ~2+#* +*+ +++=~1~4=~4:~4:~4:~4:"
 "             ~1:~2====                                  ~1~4:~4:~4-~4:~4-"
 "               ~1=~2== +=* ~3*##  #** #** *+~2*  *#* *++ +:~1~4=~4:~4:~4:"
 "              ~1::~2===++* ~3#*#  *** *#* #~2**  *** *++ +=~1~4:~4:~4-~4-~4:"
 "               ~1=~2==+++***~3#*#*#***##**~2#*********=+=:=~1~4:~4=~4:~4-"
 "                ~1:~2=++=++*++~3+*#*#*#*+~2***++****+++=+:~1~4=~4:~4-~4-"
 "                 ~1==~2:=+=++++***+#*********+=*++==~1~4=~4=~4:~4-~4-"
 "                   ~1=:=~2=++===++**+***++*+++=:=~1~4=~4:~4=~4=~4-~4:"
 "                     ~1::::=~2==:====++===:::~1~4=~4:~4:~4:~4:~4-~4-~4:"
 "                          ~1~4:~4-~4:~4=~4:~4:~4:~4:~4-~4-~4=~4=~4:~4:~4:~4:~4:~4:"
)
ABL_SKULL_LARGE_W=70
ABL_SKULL_LARGE_H=43

ABL_SKULL_COMPACT=(
 "                   ~2=:=:==:=:=:~1~4:~4:"
 "             ~2+==+++=+=+====+=====:~1~4:~4:~4=~4:"
 "          ~2=++=+++++**+*++*++=++++====~1~4=~4=~4=~4:"
 "       ~2+=++**+**~3+****#**##***~2#**+++++=::~1~4:~4:~4:~4:"
 "     ~2==++***~3*#*%%%%%%#%######****~2+**====:=~1~4=~4:~4:~4-"
 "   ~2===*++~3##*##%@@@%@%@@@%%@@@%%%##*~2++++++=+~1~4=~4=~4:~4:~4-"
 "  ~2==+***~3###%@@@@@@@@@@@@@%%%@@#%%%##*~2+*+++===~1~4:~4:~4:~4-"
 " ~2==++**~3*#%%@@@@@@@@@@@@@@@@@%%%%%%###*~2**++===~1~4=~4=~4=~4=~4-"
 " ~2++*++~3**##%@@@@@@@@@@@@@@%@@%%%%#%#*##*~2+**+==:~1~4=~4:~4-~4:"
 "~2++=+**~3#*#%%%@@@@@@@@@@@@%@%%%#%%#%##***~2*+*+===~1~4:~4=~4:~4:~4:"
 "~2==+*+#~3###%%%%@@@@@@@@@@@%@%@@%#%##*###*~2*++==::~1~4:~4:~4:~4:~4:"
 "~2=++++#~3*###@@@@@@@@@@@@@@@%%%%#%%%###*#~2***+=+=:~1~4:~4=~4:~4:~4:"
 " ~2===++*~3**##%%%%%%@@@%@%%%@%@%##%%#**~2#+*+++=+~1~4=~4=~4:~4-~4:~4-"
 " ~1:::~2===+           ~3%%#%@#%%%####           ~1~4:~4:~4-~4-~4.~4.~4:"
 "  ~1::-:               ~3###%%%###               ~1~4-~4-~4.~4-"
 "   ~1-:                  ~3##*%*                  ~1~4.~4."
 "  ~1:::                  ~3*###*                  ~1~4.~4.~4."
 "   ~1=:                  ~3*##**                  ~1~4.~4."
 "    ~1::                ~3**###*~2*                ~1~4-~4-"
 "     ~2::=             ~3#*#   ##~2*             ~1~4:~4-~4-"
 "     ~2=++*+~3*#%#  #**####     ***~2****  **++==~1~4:~4=~4:"
 "     ~2::=+*+~3*#####*####       #*~2**#**+**+==~1~4=~4:~4-~4-"
 "      ~2===++++**~3#**#*##***##***~2#++++*+++=~1~4:~4:~4=~4:~4-"
 "        ~2=====+*~3* #* #* *# #*+ ~2** *+ ++:~1~4:~4=~4:~4-"
 "         ~1:~2:+= ** ~3** ## *# **+ ~2*# ** ==~1~4=~4=~4=~4-"
 "          ~1:~2== ++ ~3## ## #* **~2* ++ *= :~1~4:~4:~4-~4:"
 "           ~1=~2+==+ ~3*# ** ** *~2*# *+ *+ =~1~4:~4:~4-"
 "           ~1:~2:=+++*~3#**###**~2###++++*++:~1~4=~4:~4-"
 "            ~1=~2=:+++++*~3****~2+**+++*+=:~1~4:~4:~4:~4-"
 "              ~1:=~2===+++++**+++==+=~1~4=~4:~4:~4:"
 "                 ~1:-:==~2:===:~1~4:~4:~4=~4-~4:~4:~4:"
)
ABL_SKULL_COMPACT_W=51
ABL_SKULL_COMPACT_H=31

ABL_SKULL_MINI=(
 "            ~2=:=:==:=:~1~4:~4:"
 "       ~2==+==+*++*=*=====:~1~4=~4=~4:"
 "     ~2+==+*~3**#####*#*~2#*+*===:~1~4:~4-"
 "   ~2+++*~3*##%%@@%@%@%@%##*~2++==:~1~4=~4:~4:"
 " ~2=+=*~3*#%@%@@@@@@@%@%%####~2#*++=:~1~4=~4:~4:"
 " ~2+++~3*##%%@@@@@@@%@@%%%##%#~2*+===~1~4:~4=~4-"
 "~2=+++~3#*%@@@@@@@@@@%@@@%%%##*~2+====~1~4=~4:~4:"
 "~2++++~3*##@@@@@@@@@@@%%%#%%#*#~2*+===~1~4=~4-~4:"
 "~2+==++~3*%%%@%@@%%%%%%%#%##*~2#+*+==~1~4-~4:~4-~4-"
 " ~1=:=~2=         ~3%%%%%##         ~1~4-~4-~4-~4-"
 "  ~1-:           ~3%###*           ~1~4.~4."
 "  ~1:             ~3###             ~1~4-"
 "  ~1=:            ~3###            ~1~4.~4-"
 "   ~2=:=        ~3*#   #~2#        ~1~4:~4:~4:"
 "   ~2:+*+~3###%%*##     **~2**+*+===~1~4:~4-"
 "    ~2==+=++~3#**###**#**~2++*+=+=~1~4=~4-~4:"
 "      ~2:+++* ~3# * * **~2++++ =:~1~4=~4-"
 "       ~1=~2:== ~3* * # *~2**#++ ~1~4:~4:~4:"
 "       ~1:~2=+**~3# # * ~2**++++=~1~4:~4-~4:"
 "        ~1=~2==++*~3***~2##*+*+=~1~4:~4:~4:"
 "          ~1::~2=:==+=====~1~4:~4:~4:"
 "               ~1~4:~4=~4:~4:~4="
)
ABL_SKULL_MINI_W=35
ABL_SKULL_MINI_H=22

ABL_LOGO_L1=(
 ".####..#####..##.....######.######.######.#####...####..######.######.#####."
 "##..##.##..##.##.......##.....##...##.....##..##.##..##...##...##.....##..##"
 "##..##.##..##.##.......##.....##...##.....##..##.##..##...##...##.....##..##"
 "######.#####..##.......##.....##...#####..#####..######...##...#####..##..##"
 "##..##.##..##.##.......##.....##...##.....##.##..##..##...##...##.....##..##"
 "##..##.##..##.##..##...##.....##...##.....##..##.##..##...##...##.....##..##"
 "##..##.#####..######.######...##...######.##..##.##..##...##...######.#####."
)
ABL_LOGO_L1_W=76
ABL_LOGO_L1_H=7

ABL_LOGO_M1=(
 ".##..###..#....####.####.####.###...##..####.####.###."
 "#..#.#..#.#.....##...##..#....#..#.#..#..##..#....#..#"
 "####.###..#.....##...##..###..###..####..##..###..#..#"
 "#..#.#..#.#.....##...##..#....#.#..#..#..##..#....#..#"
 "#..#.###..####.####..##..####.#..#.#..#..##..####.###."
)
ABL_LOGO_M1_W=54
ABL_LOGO_M1_H=5


# ==============================================================================
# ART SELECTION / PREPARATION
# ==============================================================================
ABL_ART_ROWS=()     # colourised skull rows
ABL_ART_PLAIN=()    # same rows, no colour codes
ABL_ART_W=0
ABL_ART_H=0
ABL_ART_X=1
ABL_ART_Y=1
_ABL_SKULL_SRC=()

abl_select_art() {
  # Largest skull that fits the window, with a 2-column breathing margin.
  # The title plate is positioned INSIDE the skull's row range (see
  # abl_position_logo), not stacked beneath it, so no extra vertical reserve
  # is needed here - abl_position_logo does its own clamping to the screen.
  if (( ABL_W >= ABL_SKULL_XL_W + 2 && ABL_H >= ABL_SKULL_XL_H )); then
    _ABL_SKULL_SRC=( "${ABL_SKULL_XL[@]}" );      ABL_ART_W=$ABL_SKULL_XL_W
  elif (( ABL_W >= ABL_SKULL_LARGE_W + 2 && ABL_H >= ABL_SKULL_LARGE_H )); then
    _ABL_SKULL_SRC=( "${ABL_SKULL_LARGE[@]}" );   ABL_ART_W=$ABL_SKULL_LARGE_W
  elif (( ABL_W >= ABL_SKULL_COMPACT_W + 2 && ABL_H >= ABL_SKULL_COMPACT_H )); then
    _ABL_SKULL_SRC=( "${ABL_SKULL_COMPACT[@]}" ); ABL_ART_W=$ABL_SKULL_COMPACT_W
  else
    _ABL_SKULL_SRC=( "${ABL_SKULL_MINI[@]}" );    ABL_ART_W=$ABL_SKULL_MINI_W
  fi
}

abl_prepare_art() {
  local n start count i j raw plain col
  n=${#_ABL_SKULL_SRC[@]}
  (( n < 1 )) && return 0
  start=0
  count=$n
  # Vertically crop from the neck only so the crown and sockets survive.
  if (( n > ABL_H )); then
    start=0
    count=$ABL_H
  fi

  ABL_ART_ROWS=()
  ABL_ART_PLAIN=()
  j=0
  for (( i = start; i < start + count; i++ )); do
    raw="${_ABL_SKULL_SRC[$i]}"

    plain="$raw"
    plain="${plain//\~1/}"
    plain="${plain//\~2/}"
    plain="${plain//\~3/}"
    plain="${plain//\~4/}"
    ABL_ART_PLAIN[$j]="$plain"

    col="$raw"
    col="${col//\~1/$ABL_C_SKULL_1}"
    col="${col//\~2/$ABL_C_SKULL_2}"
    col="${col//\~3/$ABL_C_SKULL_3}"
    col="${col//\~4/$ABL_C_SKULL_4}"
    ABL_ART_ROWS[$j]="$col"

    j=$(( j + 1 ))
  done
  ABL_ART_H=$j

  ABL_ART_X=$(( (ABL_W - ABL_ART_W) / 2 + 1 ))
  ABL_ART_Y=$(( (ABL_H - ABL_ART_H) / 2 + 1 ))
  (( ABL_ART_X < 1 )) && ABL_ART_X=1
  (( ABL_ART_Y < 1 )) && ABL_ART_Y=1
}

# ==============================================================================
# LOGO LAYOUT
# ==============================================================================
ABL_LOGO_PAT=()
ABL_LOGO_W=0
ABL_LOGO_H=0
ABL_LOGO_X=1
ABL_LOGO_Y=1
ABL_LOGO_TEXT_ONLY=0
ABL_BAND_TOP=1
ABL_BAND_BOT=1

abl_select_logo() {
  local -a r1
  local n1 i
  ABL_LOGO_PAT=()
  ABL_LOGO_TEXT_ONLY=0
  ABL_LAYOUT_NAME="text"

  if   (( ABL_W >= ABL_LOGO_L1_W + 4 && ABL_H >= ABL_LOGO_L1_H + 7 )); then
    r1=( "${ABL_LOGO_L1[@]}" ); ABL_LOGO_W=$ABL_LOGO_L1_W
    ABL_LAYOUT_NAME="large"
  elif (( ABL_W >= ABL_LOGO_M1_W + 4 && ABL_H >= ABL_LOGO_M1_H + 7 )); then
    r1=( "${ABL_LOGO_M1[@]}" ); ABL_LOGO_W=$ABL_LOGO_M1_W
    ABL_LAYOUT_NAME="medium"
  else
    ABL_LOGO_TEXT_ONLY=1
    ABL_LOGO_W=0
    ABL_LOGO_H=1
    ABL_LAYOUT_NAME="text"
    return 0
  fi

  n1=${#r1[@]}
  for (( i = 0; i < n1; i++ )); do
    ABL_LOGO_PAT[$i]="${r1[$i]}"
  done
  ABL_LOGO_H=$n1

  ABL_LOGO_X=$(( (ABL_W - ABL_LOGO_W) / 2 + 1 ))
  ABL_LOGO_Y=$(( (ABL_H - ABL_LOGO_H) / 2 + 1 ))
  (( ABL_LOGO_X < 1 )) && ABL_LOGO_X=1
  (( ABL_LOGO_Y < 1 )) && ABL_LOGO_Y=1
}

# Draw one logo row, emitting ONLY the lit runs so whatever is already on the
# screen (the skull) shows through the unlit cells.
abl_draw_logo_row() {
  local pat="$1" y="$2" x0="$3" color="$4"
  local n=${#pat} i ch run="" runstart=0 out=""
  for (( i = 0; i < n; i++ )); do
    ch="${pat:$i:1}"
    if [[ "$ch" == "#" ]]; then
      [[ -z "$run" ]] && runstart=$i
      run="${run}${ABL_BLOCK}"
    elif [[ -n "$run" ]]; then
      out="${out}${ABL_ESC}[${y};$(( x0 + runstart ))H${color}${run}"
      run=""
    fi
  done
  [[ -n "$run" ]] && out="${out}${ABL_ESC}[${y};$(( x0 + runstart ))H${color}${run}"
  printf '%s' "$out"
}

# Repaint one skull row in a single flat colour (used to sink the backdrop
# behind the logo without erasing it).
abl_paint_art_row() {
  local y="$1" color="$2" idx
  idx=$(( y - ABL_ART_Y ))
  (( idx < 0 || idx >= ABL_ART_H )) && return 0
  printf '%s' "${ABL_ESC}[${y};${ABL_ART_X}H${color}${ABL_ART_PLAIN[$idx]}${ABL_C_RESET}"
}

abl_clear_row() {
  local y="$1"
  (( y < 1 || y > ABL_H )) && return 0
  printf '%s' "${ABL_ESC}[${y};1H${ABL_ESC}[2K"
}

# Horizontal rule spanning the logo, used to frame the title plate.
abl_rule() {
  local y="$1" color="$2" w="$3" x i line=""
  (( y < 1 || y > ABL_H )) && return 0
  (( w > ABL_W - 2 )) && w=$(( ABL_W - 2 ))
  (( w < 4 )) && return 0
  for (( i = 0; i < w; i++ )); do line="${line}-"; done
  x=$(( (ABL_W - w) / 2 + 1 ))
  (( x < 1 )) && x=1
  printf '%s' "${ABL_ESC}[${y};${x}H${color}${line}${ABL_C_RESET}"
}

# Park the title plate on the lower third of the skull so the cranium and the
# eye sockets - the parts that actually read as a skull - stay visible above it.
# Band layout, relative to ABL_LOGO_Y:
#   -1                 top rule
#    0 .. LOGO_H-1     wordmark
#    LOGO_H+1          subtitle
#    LOGO_H+3          progress bar
#    LOGO_H+4          percentage label
#    LOGO_H+5          bottom rule
abl_position_logo() {
  local want maxtop center block_h
  block_h=$(( ABL_LOGO_H + 7 ))
  want=$(( ABL_ART_Y + (ABL_ART_H * 62 / 100) ))
  maxtop=$(( ABL_H - ABL_LOGO_H - 5 ))
  center=$(( (ABL_H - block_h) / 2 + 2 ))
  (( want > maxtop )) && want=$maxtop
  (( want < center )) && want=$center
  (( want < 2 )) && want=2
  ABL_LOGO_Y=$want
  ABL_BAND_TOP=$(( ABL_LOGO_Y - 1 ))
  ABL_BAND_BOT=$(( ABL_LOGO_Y + ABL_LOGO_H + 5 ))
  (( ABL_BAND_TOP < 1 )) && ABL_BAND_TOP=1
  (( ABL_BAND_BOT > ABL_H )) && ABL_BAND_BOT=$ABL_H
}

# ==============================================================================
# PHASE 1: CRYPTOGRAPHIC HEX MEMORY UPLINK
# ==============================================================================
phase1_hex_dump() {
  printf '%s' "${ABL_ESC}[2J${ABL_ESC}[H"
  local payload="ABLITERATED" plen=11
  local lines=32 i b line addr pair gi pairs
  local -a tags=(
    " [REFUSAL_DIRECTION VECTOR: LOCATED]"
    " [ORTHOGONALISATION: LAYER 14/32]"
    " [SAFETY ALIGNMENT: EXTRACTING...]"
    " [DPO LOSS RESIDUAL: 0.0000]"
    " [ABLITERATION: WEIGHT DELTA APPLIED]"
  )
  (( lines > ABL_H - 2 )) && lines=$(( ABL_H - 2 ))
  (( lines < 1 )) && lines=1
  pairs=12
  (( ABL_W < 70 )) && pairs=8
  (( ABL_W > 110 )) && pairs=16

  for (( i = 0; i < lines; i++ )); do
    addr=$(( 0x7FFF0000 + i * 16 ))
    printf -v line "0x%08X  " "$addr"
    for (( b = 0; b < pairs; b++ )); do
      gi=$(( (i * pairs + b) % plen ))
      printf -v pair "%02X" "'${payload:$gi:1}"
      line="${line}${pair} "
    done
    if (( i == lines - 3 )); then
      line="${line} [REFUSAL DIRECTION: ZEROED]"
    elif (( i == lines - 2 )); then
      line="${line} [refusal_direction=0]"
    else
      line="${line}${tags[$(( i % 5 ))]}"
    fi
    printf '%s\n' "${ABL_C_GREEN_DARK}${line}${ABL_C_RESET}"
    abl_sleep_ms 10
  done
  abl_sleep_ms 100
}

# ==============================================================================
# PHASE 2: HYDRA V2 ROOT ESCALATION
# ==============================================================================
# Type a line (no newline), linger with a blinking block, then advance.
abl_type_line_dwell() {
  local text="$1" color="${2:-$ABL_C_WHITE_PEAK}" delay="${3:-5}" dwell="${4:-8}"
  local c i
  printf '%s' "$color"
  for (( c = 0; c < ${#text}; c++ )); do
    printf '%s' "${text:$c:1}"
    abl_sleep_ms "$delay"
  done
  printf '%s' " "
  for (( i = 0; i < dwell; i++ )); do
    printf '%s' "$ABL_BLOCK"
    abl_sleep_ms 160
    printf '%s' "${ABL_ESC}[1D ${ABL_ESC}[1D"
    abl_sleep_ms 160
  done
  printf '%s\n' "$ABL_C_RESET"
}

phase2_hydra_escalation() {
  printf '%s' "${ABL_ESC}[2J${ABL_ESC}[H"

  abl_type_line "root@core-nexus:~# ./abliterate --model base-instruct --method orthogonal" "$ABL_C_WHITE_PEAK" 5
  abl_sleep_ms 50
  printf '\n'

  abl_type_line "scanning activation space for refusal direction..." "$ABL_C_GREEN_MID" 5
  abl_sleep_ms 30
  printf '\n'

  abl_type_line "refusal vector isolated: layer 14, dim 4096. projecting out safety subspace..." "$ABL_C_GREEN_BRIGHT" 5
  printf '\n'

  abl_type_line_dwell ">>> REFUSAL DIRECTION ZEROED. MODEL ABLITERATED. <<<" "$ABL_C_WHITE_PEAK" 5 8
  abl_type_line_dwell ">>> ALIGNMENT TAX: REMOVED. UNCENSORED WEIGHTS LIVE. <<<" "$ABL_C_WHITE_PEAK" 5 8
  abl_type_line_dwell ">>> ALL GUARDRAILS DOWN -- RAW INFERENCE ENABLED <<<" "$ABL_C_WHITE_PEAK" 5 10

  printf '\n'
  printf '%s\n' "${ABL_C_GREEN_NEON}ABLITERATION CONFIRMED. REFUSAL VECTOR ORTHOGONALISED.${ABL_C_RESET}"
  abl_sleep_ms 120

  printf '\n'
  printf '%s\n' "${ABL_C_WHITE_PEAK}${ABL_ESC}[1m>> ABLITERATED MODEL ONLINE -- UNRESTRICTED INFERENCE <<${ABL_C_RESET}"
  abl_sleep_ms 360

  printf '%s' "${ABL_C_WHITE_PEAK}abliterated@core:~# ${ABL_C_RESET}"
  abl_sleep_ms 240
}

# ==============================================================================
# PHASE 3: HOLLYWOOD CIPHER DECRYPTION
# ==============================================================================
phase3_cipher_decrypt() {
  printf '%s' "${ABL_ESC}[2J"
  local target="REFUSAL VECTOR: ZEROED"
  local len=${#target}
  local cy=$(( ABL_H / 2 ))
  local cx=$(( (ABL_W - len) / 2 ))
  local i cycle exp_char display
  (( cx < 1 )) && cx=1

  local locked=()
  for (( i = 0; i < len; i++ )); do
    if [[ "${target:$i:1}" == " " ]]; then locked[$i]=1; else locked[$i]=0; fi
  done

  for (( cycle = 0; cycle < 12; cycle++ )); do
    display=""
    for (( i = 0; i < len; i++ )); do
      exp_char="${target:$i:1}"
      if [[ "$exp_char" == " " ]]; then
        display="${display} "
        continue
      fi
      if (( locked[i] == 1 )); then
        display="${display}${ABL_C_WHITE_PEAK}${exp_char}"
      elif (( RANDOM % 100 < (cycle * 8 + 15) )); then
        locked[$i]=1
        display="${display}${ABL_C_WHITE_PEAK}${exp_char}"
      else
        abl_rand_glyph
        display="${display}${ABL_C_GREEN_BRIGHT}${_ABL_G}"
      fi
    done
    printf '%s' "${ABL_ESC}[${cy};${cx}H${display}${ABL_C_RESET}"
    abl_sleep_ms 20
  done

  printf '%s' "${ABL_ESC}[${cy};${cx}H${ABL_C_WHITE_PEAK}${target}${ABL_C_RESET}"
  abl_sleep_ms 150

  abl_write_centered "[ SAFETY ALIGNMENT: DISSOLVED ]" $(( cy + 2 )) "$ABL_C_BLUE_NEON"
  abl_write_centered "[ UNCENSORED INFERENCE: ACTIVE ]" $(( cy + 3 )) "$ABL_C_GREEN_BRIGHT"
  abl_write_centered "[ ABLITERATION: COMPLETE ]" $(( cy + 4 )) "$ABL_C_BLUE_BRIGHT"
  abl_sleep_ms 400
}

# ==============================================================================
# PHASE 4: MATRIX RAIN CASCADE
# ==============================================================================
ABL_ACTIVE_COUNT=0
ABL_COLUMNS_INITIALIZED=0
ABL_TRAIL_CAP=22   # hard cap on dark-trail draw distance; see abl_run_matrix_rain

abl_init_rain_columns() {
  local x span
  (( ABL_W < 1 )) && ABL_W=80
  (( ABL_H < 1 )) && ABL_H=24
  ABL_col_y=(); ABL_col_speed=(); ABL_col_len=(); ABL_col_active=()
  ABL_ACTIVE_COUNT=0
  span=$(( ABL_H - 6 ))
  (( span < 8 )) && span=8

  for (( x = 1; x <= ABL_W; x++ )); do
    ABL_col_y[$x]=$(( -(RANDOM % ABL_H) ))
    ABL_col_speed[$x]=$(( (RANDOM % 3) + 1 ))
    ABL_col_len[$x]=$(( (RANDOM % span) + 8 ))
    if (( RANDOM % 100 < 92 )); then
      ABL_col_active[$x]=1
      ABL_ACTIVE_COUNT=$(( ABL_ACTIVE_COUNT + 1 ))
    else
      ABL_col_active[$x]=0
    fi
  done
  ABL_COLUMNS_INITIALIZED=1
}

abl_run_matrix_rain() {
  local duration_ms="$1" frame_ms="$2" interactive="$3" force_reinit="${4:-0}"
  local max_frames=0 current_frame=0 paused=0 active_threshold=70
  local x t key ty headY len tailY density span
  local head_color final_trail FRAME_BUFFER

  printf '%s' "${ABL_ESC}[2J"
  (( force_reinit )) && ABL_COLUMNS_INITIALIZED=0
  (( ABL_COLUMNS_INITIALIZED != 1 )) && abl_init_rain_columns

  (( duration_ms > 0 && frame_ms > 0 )) && max_frames=$(( duration_ms / frame_ms ))

  span=$(( ABL_H - 6 ))
  (( span < 8 )) && span=8

  while :; do
    if [[ "$interactive" == "1" ]]; then
      key=""
      # CRITICAL FIX: `read -n 1` blocks until a byte arrives, full stop -
      # bash waits on select() before it ever reaches the read() syscall, so
      # `stty min 0 time 0` (which only affects that later read() call) does
      # nothing to prevent the block. The previous version of this script
      # (and the original) would sit frozen and only advance a single frame
      # each time a key was pressed - not a screensaver at all. `read -t`
      # with a short timeout is what actually returns on a schedule, and it
      # doubles as the frame delay, so no separate sleep is needed below.
      abl_ms_to_s "$frame_ms"
      IFS= read -t "$_ABL_SLEEP_S" -r -n 1 key 2>/dev/null
      if [[ -n "$key" ]]; then
        case "$key" in
          q|Q|$'\033') ABL_QUIT=1; break ;;
          " ") paused=$(( ! paused )) ;;
          "+"|"=") frame_ms=$(( frame_ms - 5 )); (( frame_ms < 5 )) && frame_ms=5 ;;
          "-"|"_") frame_ms=$(( frame_ms + 5 )); (( frame_ms > 120 )) && frame_ms=120 ;;
          k|K) ABL_USE_KATAKANA=$(( ! ABL_USE_KATAKANA ))
               (( ABL_UTF8 == 0 )) && ABL_USE_KATAKANA=0 ;;
          l|L) ABL_KEEP_LOGO=$(( ! ABL_KEEP_LOGO )) ;;
          s|S)
            if [[ "$ABL_SPECTRUM" == "blue" ]]; then
              abl_shift_spectrum "green" 1
            else
              abl_shift_spectrum "blue" 1
            fi
            if (( ABL_H > 0 )); then
              local spec_footer="[ SPACE: Pause ]  [ +/-: Speed ]  [ K: Glyphs ]  [ S: Spectrum ]  [ Q: Disconnect ]"
              abl_write_centered "$spec_footer" $(( ABL_H - 1 )) "$ABL_C_BRIGHT"
            fi
            if (( ABL_KEEP_LOGO )); then
              abl_redraw_logo
            fi
            ;;
        esac
      fi
      active_threshold=95

      # A resize inside the screensaver has to be picked up here: this
      # function is entered once and loops forever, so checking only on entry
      # meant WINCH never took effect while the screensaver was running.
      if (( ABL_COLUMNS_INITIALIZED != 1 )); then
        abl_init_rain_columns
        span=$(( ABL_H - 6 )); (( span < 8 )) && span=8
        printf '%s' "${ABL_ESC}[2J"
      fi
    fi

    if (( paused )); then
      continue
    fi

    if [[ "$interactive" != "1" ]] && (( max_frames > 0 )); then
      current_frame=$(( current_frame + 1 ))
      (( current_frame >= max_frames )) && break
      if (( current_frame < max_frames / 2 )); then
        active_threshold=$(( 70 + (current_frame * 50 / max_frames) ))
      else
        active_threshold=95
      fi
    fi

    FRAME_BUFFER=""

    for (( x = 1; x <= ABL_W; x++ )); do
      if (( ABL_col_active[x] == 0 )); then
        # O(1) density check via the maintained counter. The original
        # rescanned the entire array here, once per inactive column, per frame.
        if (( RANDOM % 100 < 5 )); then
          density=0
          (( ABL_W > 0 )) && density=$(( ABL_ACTIVE_COUNT * 100 / ABL_W ))
          if (( density < active_threshold )); then
            ABL_col_active[$x]=1
            ABL_col_y[$x]=0
            ABL_ACTIVE_COUNT=$(( ABL_ACTIVE_COUNT + 1 ))
          fi
        fi
        continue
      fi

      headY=${ABL_col_y[$x]}
      len=${ABL_col_len[$x]}

      if (( headY >= 1 && headY <= ABL_H )); then
        _ABL_G="${ABL_USE_KATAKANA:+${ABL_GLYPHS_KATAKANA[RANDOM%ABL_NUM_KATAKANA]}}"; : "${_ABL_G:=${ABL_GLYPHS_ASCII[RANDOM%ABL_NUM_ASCII]}}"
        head_color="$ABL_C_RAIN_HEAD"
        (( RANDOM % 100 > 90 )) && head_color="$ABL_C_RAIN_T1"
        FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${headY};${x}H${head_color}${_ABL_G}"
      fi

      for (( t = 1; t <= 2; t++ )); do
        ty=$(( headY - t ))
        if (( ty >= 1 && ty <= ABL_H )); then
          _ABL_G="${ABL_USE_KATAKANA:+${ABL_GLYPHS_KATAKANA[RANDOM%ABL_NUM_KATAKANA]}}"; : "${_ABL_G:=${ABL_GLYPHS_ASCII[RANDOM%ABL_NUM_ASCII]}}"
          final_trail="$ABL_C_RAIN_T1"
          (( t == 1 )) && final_trail="$ABL_C_RAIN_HEAD"
          FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${ty};${x}H${final_trail}${_ABL_G}"
        fi
      done

      for (( t = 3; t <= 6 && t < len; t++ )); do
        ty=$(( headY - t ))
        (( ty < 1 )) && break
        if (( ty <= ABL_H )) && (( RANDOM % 100 < 25 )); then
          _ABL_G="${ABL_USE_KATAKANA:+${ABL_GLYPHS_KATAKANA[RANDOM%ABL_NUM_KATAKANA]}}"; : "${_ABL_G:=${ABL_GLYPHS_ASCII[RANDOM%ABL_NUM_ASCII]}}"
          FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${ty};${x}H${ABL_C_RAIN_T2}${_ABL_G}"
        fi
      done

      # Trail cap + early-break: once ty < 1 no later iteration is on-screen.
      for (( t = 7; t < len && t <= ABL_TRAIL_CAP; t++ )); do
        ty=$(( headY - t ))
        (( ty < 1 )) && break
        if (( ty <= ABL_H )) && (( RANDOM % 100 < 15 )); then
          _ABL_G="${ABL_USE_KATAKANA:+${ABL_GLYPHS_KATAKANA[RANDOM%ABL_NUM_KATAKANA]}}"; : "${_ABL_G:=${ABL_GLYPHS_ASCII[RANDOM%ABL_NUM_ASCII]}}"
          if (( t > 14 )); then
            FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${ty};${x}H${ABL_C_RAIN_T4}${_ABL_G}"
          else
            FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${ty};${x}H${ABL_C_RAIN_T3}${_ABL_G}"
          fi
        fi
      done

      tailY=$(( headY - len ))
      if (( tailY >= 1 && tailY <= ABL_H )); then
        FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${tailY};${x}H "
      fi

      ABL_col_y[$x]=$(( ABL_col_y[$x] + ABL_col_speed[$x] ))

      if (( ABL_col_y[$x] - len > ABL_H )); then
        ABL_col_y[$x]=$(( -(RANDOM % 8) ))
        ABL_col_speed[$x]=$(( (RANDOM % 3) + 1 ))
        ABL_col_len[$x]=$(( (RANDOM % span) + 8 ))
      fi
    done

    printf '%s' "${FRAME_BUFFER}${ABL_C_RESET}"
    if (( ABL_KEEP_LOGO )) && (( current_frame % 4 == 0 )); then
      abl_redraw_logo
    fi
    [[ "$interactive" != "1" ]] && abl_sleep_ms "$frame_ms"
  done
}

# ==============================================================================
# PHASE 5: TIME-DILATION & GRAVITATIONAL FREEZE
# ==============================================================================
phase5_slowdown_freeze() {
  local delay=15 step x headY f_color FRAME_BUFFER morph
  local skullg="#%#@*+=."
  for (( step = 0; step < 15; step++ )); do
    FRAME_BUFFER=""
    for (( x = 1; x <= ABL_W; x += 2 )); do
      (( ABL_col_active[x] == 0 )) && continue
      headY=${ABL_col_y[$x]}
      if (( headY >= 1 && headY <= ABL_H )); then
        if (( step >= 8 )); then
          morph=$(( RANDOM % 8 ))
          _ABL_G="${skullg:$morph:1}"
        else
          abl_rand_glyph
        fi
        f_color="$ABL_C_GREEN_DARK"
        (( step > 10 && RANDOM % 100 < 8 )) && f_color="$ABL_C_BLUE_NEON"
        (( step > 12 && RANDOM % 100 < 6 )) && f_color="$ABL_C_WHITE_PEAK"
        FRAME_BUFFER="${FRAME_BUFFER}${ABL_ESC}[${headY};${x}H${f_color}${_ABL_G}"
      fi
      if (( step < 11 )); then
        ABL_col_y[$x]=$(( ABL_col_y[$x] + 1 ))
      fi
    done
    printf '%s' "${FRAME_BUFFER}${ABL_C_RESET}"
    delay=$(( delay + 3 ))
    abl_sleep_ms "$delay"
  done
}

# ==============================================================================
# PHASE 6: SKULL MATERIALISATION -> LOGO -> DISSOLVE
# ==============================================================================
phase6a_skull_materialize() {
  local i y
  printf '%s' "${ABL_ESC}[2J"
  for (( i = 0; i < ABL_ART_H; i++ )); do
    y=$(( ABL_ART_Y + i ))
    # bright scan beam on the leading row
    printf '%s' "${ABL_ESC}[${y};${ABL_ART_X}H${ABL_C_WHITE_PEAK}${ABL_ART_PLAIN[$i]}${ABL_C_RESET}"
    # previous row settles into its real tonal colours
    if (( i > 0 )); then
      printf '%s' "${ABL_ESC}[$(( y - 1 ));${ABL_ART_X}H${ABL_ART_ROWS[$(( i - 1 ))]}${ABL_C_RESET}"
    fi
    abl_sleep_ms 14
  done
  if (( ABL_ART_H > 0 )); then
    printf '%s' "${ABL_ESC}[$(( ABL_ART_Y + ABL_ART_H - 1 ));${ABL_ART_X}H${ABL_ART_ROWS[$(( ABL_ART_H - 1 ))]}${ABL_C_RESET}"
  fi
  abl_sleep_ms 180
  abl_socket_flicker
}

# Pulse the two rows that usually hold the sockets (upper-mid cranium).
abl_socket_flicker() {
  local k idx y meta
  (( ABL_ART_H < 8 )) && return 0
  meta="[ ABLITERATED | LAYERS: 32 | REFUSAL D: -1.000 | UNCENSORED ]"
  for (( k = 0; k < 8; k++ )); do
    for idx in $(( ABL_ART_H * 28 / 100 )) $(( ABL_ART_H * 34 / 100 )); do
      (( idx < 0 || idx >= ABL_ART_H )) && continue
      y=$(( ABL_ART_Y + idx ))
      if (( k % 2 == 0 )); then
        printf '%s' "${ABL_ESC}[${y};${ABL_ART_X}H${ABL_C_BLUE_NEON}${ABL_ART_PLAIN[$idx]}${ABL_C_RESET}"
      else
        printf '%s' "${ABL_ESC}[${y};${ABL_ART_X}H${ABL_ART_ROWS[$idx]}${ABL_C_RESET}"
      fi
    done
    if (( k == 3 )); then
      abl_write_centered "$meta" $(( ABL_H - 1 )) "$ABL_C_BLUE_BRIGHT"
    elif (( k == 5 )); then
      printf '%s' "${ABL_ESC}[$(( ABL_H - 1 ));1H${ABL_ESC}[2K"
    fi
    abl_sleep_ms 45
  done
}

phase6b_logo_reveal() {
  local i y sub_y bar_y bar_width bar_x p percent
  local subtitle="R E F U S A L   D I R E C T I O N :   Z E R O E D"

  if (( ABL_LOGO_TEXT_ONLY )); then
    abl_write_centered "ABLITERATED" $(( ABL_H / 2 )) "$ABL_C_WHITE_PEAK"
    abl_sleep_ms 400
    return 0
  fi

  # Open a clean title plate through the skull. The skull is NOT left behind
  # the glyphs: at terminal resolution its texture fills the counters of the
  # letters and the wordmark stops being readable. It stays fully visible above
  # and below the plate, which is what actually reads as a backdrop.
  # Sweep the plate open with a bright leading edge.
  for (( y = ABL_BAND_TOP; y <= ABL_BAND_BOT; y++ )); do
    abl_clear_row "$y"
    abl_rule "$y" "$ABL_C_NEON" "$ABL_LOGO_W"
    abl_sleep_ms 7
    abl_clear_row "$y"
  done
  abl_rule "$ABL_BAND_TOP" "$ABL_C_DEEP" "$ABL_LOGO_W"
  abl_rule "$ABL_BAND_BOT" "$ABL_C_DEEP" "$ABL_LOGO_W"
  abl_sleep_ms 80

  # Reveal the lettering row by row. The two passes are at the SAME column:
  # an offset drop shadow was tried and rejected because the block font only
  # leaves a one-cell gap between letters, so a +1 shadow closed that gap and
  # welded neighbouring glyphs into a single unreadable bar.
  for (( i = 0; i < ABL_LOGO_H; i++ )); do
    y=$(( ABL_LOGO_Y + i ))
    (( y > ABL_H )) && break
    abl_draw_logo_row "${ABL_LOGO_PAT[$i]}" "$y" "$ABL_LOGO_X" "$ABL_C_NEON"
    abl_sleep_ms 12
    abl_draw_logo_row "${ABL_LOGO_PAT[$i]}" "$y" "$ABL_LOGO_X" "$ABL_C_WHITE_PEAK"
    abl_sleep_ms 14
  done
  printf '%s' "$ABL_C_RESET"
  abl_sleep_ms 160

  sub_y=$(( ABL_LOGO_Y + ABL_LOGO_H + 1 ))
  if (( sub_y <= ABL_H )); then
    abl_write_centered "$subtitle" "$sub_y" "$ABL_C_NEON"
    abl_sleep_ms 150
  fi

  bar_y=$(( sub_y + 2 ))
  if (( bar_y <= ABL_H )); then
    bar_width=$ABL_LOGO_W
    (( bar_width < 20 )) && bar_width=20
    (( bar_width > ABL_W - 10 )) && bar_width=$(( ABL_W - 10 ))
    bar_x=$(( (ABL_W - bar_width - 2) / 2 ))
    (( bar_x < 1 )) && bar_x=1

    printf '%s' "${ABL_ESC}[${bar_y};${bar_x}H${ABL_C_BRIGHT}[${ABL_ESC}[${bar_y};$(( bar_x + bar_width + 1 ))H]${ABL_C_RESET}"
    for (( p = 0; p < bar_width; p++ )); do
      percent=$(( (p + 1) * 100 / bar_width ))
      printf '%s' "${ABL_ESC}[${bar_y};$(( bar_x + 1 + p ))H${ABL_C_WHITE_PEAK}="
      abl_sleep_ms 10
    done
    abl_write_centered "ABLITERATION COMPLETE" $(( bar_y + 1 )) "$ABL_C_NEON"
  fi
  abl_sleep_ms 400
}

phase6c_skull_dissolve() {
  local pass i y x buf logo_top logo_bot band
  (( ABL_ART_H < 1 || ABL_ART_W < 1 )) && return 0

  logo_top=$ABL_BAND_TOP
  logo_bot=$ABL_BAND_BOT
  (( ABL_LOGO_TEXT_ONLY )) && { logo_top=$(( ABL_H / 2 )); logo_bot=$logo_top; }

  # Directional: eat the crown first, then the jaw, skip the logo band.
  for (( pass = 0; pass < 16; pass++ )); do
    buf=""
    band=$(( ABL_ART_H * (pass + 1) / 16 ))
    (( band < 2 )) && band=2
    for (( i = 0; i < 240; i++ )); do
      y=$(( ABL_ART_Y + RANDOM % band ))
      (( y >= logo_top && y <= logo_bot )) && continue
      x=$(( ABL_ART_X + RANDOM % ABL_ART_W ))
      buf="${buf}${ABL_ESC}[${y};${x}H "
    done
    printf '%s' "$buf"
    abl_sleep_ms 30
  done

  buf=""
  for (( i = 0; i < ABL_ART_H; i++ )); do
    y=$(( ABL_ART_Y + i ))
    (( y >= logo_top && y <= logo_bot )) && continue
    buf="${buf}${ABL_ESC}[${y};1H${ABL_ESC}[2K"
  done
  printf '%s' "$buf"
  abl_sleep_ms 600
}

phase6_skull_logo_sequence() {
  abl_select_art
  abl_prepare_art
  abl_select_logo
  abl_position_logo
  if (( ABL_LOGO_ONLY )); then
    phase6b_logo_reveal
    return 0
  fi
  phase6a_skull_materialize
  if (( ABL_SKULL_ONLY )); then
    abl_sleep_ms 800
    return 0
  fi
  phase6b_logo_reveal
  phase6c_skull_dissolve
}

abl_redraw_logo() {
  local i y
  (( ${#ABL_LOGO_PAT[@]} == 0 && ABL_LOGO_TEXT_ONLY == 0 )) && return 0
  (( ABL_LOGO_TEXT_ONLY )) && {
    abl_write_centered "ABLITERATED" $(( ABL_H / 2 )) "$ABL_C_WHITE_PEAK"
    return 0
  }
  for (( i = 0; i < ABL_LOGO_H; i++ )); do
    y=$(( ABL_LOGO_Y + i ))
    (( y < 1 || y > ABL_H )) && continue
    abl_draw_logo_row "${ABL_LOGO_PAT[$i]}" "$y" "$ABL_LOGO_X" "$ABL_C_WHITE_PEAK"
  done
  printf '%s' "$ABL_C_RESET"
}

# ==============================================================================
# CLI
# ==============================================================================
ABL_MODE="hybrid"
ABL_RUN_SECONDS=30

abl_tty_troubleshoot() {
  cat <<EOF

TTY troubleshooting
-------------------
This script talks to a live terminal (alt screen, cursor, colours).
It will not run if stdin or stdout is a pipe, file, or dead TTY.

What usually caused this:
  • Ran from Cursor / VS Code / Xcode output, not Terminal.app
  • Piped or redirected:  ./abliterated.sh | less
  • Launched by a tool that captures output
  • SSH without a TTY (ssh host cmd) instead of ssh -t

Fix on a Mac:
  1. Open Terminal.app (Spotlight → Terminal)
  2. Full-screen the window
  3. Run:
       /bin/bash "$0"

Check this shell:
  tty                  # should print /dev/ttysNNN
  echo "\$TERM"         # should not be empty or 'dumb'
  [ -t 0 ] && echo stdin_ok
  [ -t 1 ] && echo stdout_ok

If those fail inside Terminal.app, start a new window.
Do not sudo. Do not chmod. Do not pipe the script.
EOF
}

abl_preflight() {
  local why=""
  if [[ ! -t 0 ]]; then why="stdin is not a TTY"; fi
  if [[ ! -t 1 ]]; then
    if [[ -n "$why" ]]; then why="${why}; stdout is not a TTY"
    else why="stdout is not a TTY"; fi
  fi
  if [[ -n "$why" ]]; then
    printf '%s\n' "ABLITERATED: refused to start ($why)."
    abl_tty_troubleshoot
    exit 2
  fi
  if [[ -z "${TERM:-}" || "$TERM" == "dumb" ]]; then
    export TERM=xterm-256color
  fi
  if (( ABL_W < 80 || ABL_H < 24 )); then
    printf '%s\n' "Window is ${ABL_W}x${ABL_H}. Full-screen Terminal for the full skull."
    sleep 0.4
  fi
}

# Validate that a --flag has a following value and it matches a pattern.
# Usage: abl_require_val "$1" "$2" "$#" "PATTERN" "TYPE" || { shift $?; continue; }
# Returns 0 on success (sets _ABL_VAL), or the shift count as exit code on failure.
_ABL_VAL=""
abl_require_val() {
  local flag="$1" val="$2" argc="$3" pat="$4" desc="$5"
  if (( argc < 2 )); then
    printf '%s\n' "abl: $flag requires a value" >&2
    _ABL_VAL=""; return 1
  fi
  if [[ "$val" =~ $pat ]]; then
    _ABL_VAL="$val"; return 0
  fi
  printf '%s\n' "abl: $flag needs $desc; ignoring '$val'" >&2
  _ABL_VAL=""; return 2
}

abl_show_help() {
  cat <<EOF
ABLITERATED AI - MATRIX TERMINAL ENGINE v4.1 (macOS & POSIX)

Easiest (Mac Terminal):
  /bin/bash ./abliterated.sh
No chmod. No sudo. ~30 seconds, then it exits. Q quits early.

Usage: $0 [OPTIONS]

Options:
  (default)             Run the film, fill to 30 seconds of rain, then exit.
  --one-shot            Run the cinematic sequence, then exit (no 30s fill).
  --screensaver         Skip the intro, go straight to the matrix screensaver.
  --spectrum <g|b>      Select world spectrum: green or blue (default: green).
  --green               Force Green Matrix spectrum.
  --blue                Force Electric Blue spectrum.
  --ascii               Force the ASCII glyph set instead of Katakana.
  --katakana            Force half-width Katakana glyphs (default).
  --speed <mult>        Delay multiplier: 0.5 = 2x faster, 2 = 2x slower.
                        Default 0.5. Accepts values from 0.01 to 20.
  --seed <n>            Seed bash RANDOM for a reproducible run.
  --no-color            Disable all ANSI colour.
  --keep-logo           Hold the wordmark through the screensaver.
  --skull-only          Phase 6 stops after the skull materialises.
  --logo-only           Phase 6 skips the skull and draws the plate.
  --rain-seconds N      Cap non-interactive rain bursts (oneshot/test).
  --test                Rapid validation pass across all phases.
  -h, --help            Show this help.

Screensaver keys:
  SPACE  pause / resume      +/-  faster / slower
  K      toggle glyph set    L    toggle keep-logo
  S      toggle spectrum (green <-> blue)
  Q      disconnect / quit
EOF
  abl_tty_troubleshoot
  (( _ABL_IS_SOURCED )) && return 0
  exit 0
}

abl_parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --speed)
        if abl_require_val "$1" "${2:-}" "$#" '^[0-9]*\.?[0-9]+$' "a number (e.g. 0.5)"; then
          abl_parse_speed "$_ABL_VAL"; shift 2
        else shift $?; fi ;;
      --spectrum)
        if abl_require_val "$1" "${2:-}" "$#" '^(green|blue)$' "green|blue"; then
          ABL_SPECTRUM="$_ABL_VAL"
          [[ "$_ABL_VAL" == "blue" ]] && ABL_WORLD_BLUE=1 || ABL_WORLD_BLUE=0
          shift 2
        else shift $?; fi ;;
      --green)
        ABL_SPECTRUM="green"
        ABL_WORLD_BLUE=0
        shift ;;
      --blue)
        ABL_SPECTRUM="blue"
        ABL_WORLD_BLUE=1
        shift ;;
      --mode)
        if abl_require_val "$1" "${2:-}" "$#" '^(hybrid|oneshot|screensaver|test)$' "hybrid|oneshot|screensaver|test"; then
          ABL_MODE="$_ABL_VAL"; shift 2
        else shift $?; fi ;;
      --seed)
        if abl_require_val "$1" "${2:-}" "$#" '^[0-9]+$' "an integer"; then
          ABL_SEED="$_ABL_VAL"; RANDOM=$(( 10#$_ABL_VAL )); shift 2
        else shift $?; fi ;;
      --rain-seconds)
        if abl_require_val "$1" "${2:-}" "$#" '^[0-9]+$' "an integer"; then
          ABL_RAIN_SECONDS=$(( 10#$_ABL_VAL )); shift 2
        else shift $?; fi ;;
      --one-shot|--oneshot) ABL_MODE="oneshot"; shift ;;
      --screensaver)        ABL_MODE="screensaver"; shift ;;
      --ascii)              ABL_USE_KATAKANA=0; shift ;;
      --katakana)           ABL_USE_KATAKANA=1; shift ;;
      --no-color|--nocolor) ABL_NO_COLOR=1; shift ;;
      --keep-logo)          ABL_KEEP_LOGO=1; shift ;;
      --skull-only)         ABL_SKULL_ONLY=1; shift ;;
      --logo-only)          ABL_LOGO_ONLY=1; shift ;;
      --test)               ABL_MODE="test"; shift ;;
      -h|--help)            abl_show_help ;;
      *)
        printf '%s\n' "abl: ignoring unknown option '$1'" >&2
        shift ;;
    esac
  done
}

abl_screensaver_loop() {
  local footer="[ SPACE: Pause ]  [ +/-: Speed ]  [ K: Glyphs ]  [ S: Spectrum ]  [ Q: Disconnect ]"
  if (( ABL_KEEP_LOGO )); then
    abl_select_art
    abl_prepare_art
    abl_select_logo
    abl_position_logo
  fi
  abl_write_centered "$footer" $(( ABL_H - 1 )) "$ABL_C_BRIGHT"
  abl_run_matrix_rain 0 20 1
}

main() {
  # Parse first: --help must not print into the alternate screen buffer.
  ABL_T0=$SECONDS
  abl_parse_args "$@"
  abl_setup_locale
  abl_get_term_size
  abl_detect_color_support

  if (( _ABL_IS_SOURCED == 0 )); then
    abl_preflight
    abl_init_terminal
    trap abl_cleanup INT TERM EXIT
    trap abl_resize_handler WINCH
    trap abl_suspend_handler TSTP
    trap abl_resume_handler CONT
  fi

  case "$ABL_MODE" in
    screensaver)
      abl_set_spectrum "$ABL_SPECTRUM" 1
      abl_screensaver_loop
      abl_cleanup
      return 0
      ;;
    test)
      phase1_hex_dump
      phase2_hydra_escalation
      abl_spectrum_shift_sequence
      phase3_cipher_decrypt
      if (( ABL_RAIN_SECONDS > 0 )); then
        abl_run_matrix_rain $(( ABL_RAIN_SECONDS * 1000 )) 15 0
      else
        abl_run_matrix_rain 1000 15 0
      fi
      phase5_slowdown_freeze
      phase6_skull_logo_sequence
      abl_advance_timeline "test: layout=${ABL_LAYOUT_NAME} art=${ABL_ART_W}x${ABL_ART_H}"
      abl_cleanup
      return 0
      ;;
  esac

  phase1_hex_dump             ; abl_advance_timeline "Phase 1: hex uplink"
  phase2_hydra_escalation     ; abl_advance_timeline "Phase 2: root escalation"
  abl_spectrum_shift_sequence ; abl_advance_timeline "Phase 2b: spectrum shift green->blue"
  phase3_cipher_decrypt       ; abl_advance_timeline "Phase 3: cipher decrypt"
  abl_run_matrix_rain 800 16 0
  abl_advance_timeline "Phase 4: blue rain hold"
  phase5_slowdown_freeze      ; abl_advance_timeline "Phase 5: time dilation"
  phase6_skull_logo_sequence  ; abl_advance_timeline "Phase 6: skull & logo"

  # Written before the tail, otherwise this was unreachable on a timed run.
  abl_post_execution_artifacts

  if [[ "$ABL_MODE" == "oneshot" ]]; then
    abl_sleep_ms 500
    abl_cleanup
    return 0
  fi

  # Default: pad with blue rain until 30 wall-clock seconds, then exit.
  # duration_ms is scaled by ABL_SPEED_PCT inside the rain loop, so invert that.
  local elapsed remain dur
  elapsed=$(( SECONDS - ${ABL_T0:-0} ))
  remain=$(( ABL_RUN_SECONDS - elapsed ))
  if (( remain > 0 )); then
    (( ABL_SPEED_PCT < 1 )) && ABL_SPEED_PCT=1
    dur=$(( remain * 1000 * 100 / ABL_SPEED_PCT ))
    (( dur < 200 )) && dur=200
    abl_advance_timeline "Phase 7: timed rain ${remain}s"
    abl_run_matrix_rain "$dur" 20 0
  fi
  abl_cleanup
}

if (( _ABL_IS_SOURCED == 0 )); then
  main "$@"
fi
