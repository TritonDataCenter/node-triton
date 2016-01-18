# Functions for Bash completion of some 'triton' option/arg types.
function complete_tritonprofile {
    local word="$1"
    local candidates
    candidates=$(ls -1 ~/.triton/profiles.d/*.json 2>/dev/null \
        | sed -E 's/^.*\/([^\/]+)\.json$/\1/')
    compgen $compgen_opts -W "$candidates" -- "$word"
}

function complete_tritonupdateaccountfield {
    local word="$1"
    local candidates
    candidates="{{UPDATE_ACCOUNT_FIELDS}}"
    compgen $compgen_opts -W "$candidates" -- "$word"
}