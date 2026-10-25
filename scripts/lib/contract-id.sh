extract_contract_id() {
  local output="$1"
  local line
  local contract_id=""

  while IFS= read -r line; do
    if [[ "$line" =~ ^C[A-Z2-7]{55}$ ]]; then
      if [[ -n "$contract_id" ]]; then
        echo "Error: soroban returned multiple contract IDs" >&2
        return 1
      fi
      contract_id="$line"
    fi
  done <<< "$output"

  if [[ -z "$contract_id" ]]; then
    echo "Error: soroban output did not contain a valid contract ID" >&2
    return 1
  fi

  printf '%s\n' "$contract_id"
}
