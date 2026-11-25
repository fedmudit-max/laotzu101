#!/usr/bin/env bash
# Gradle needs a JDK; macOS often has no /usr/bin/java unless JAVA_HOME is set.
# Prefer existing JAVA_HOME, then Android Studio's bundled JBR.
set -euo pipefail

resolve_java_home() {
    if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
        return 0
    fi
    local as_jbr="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    if [[ -x "${as_jbr}/bin/java" ]]; then
        export JAVA_HOME="$as_jbr"
        return 0
    fi
    return 1
}

if ! resolve_java_home; then
    echo "ERROR: No Java runtime for Gradle." >&2
    echo "Install Android Studio or a JDK, then either:" >&2
    echo "  export JAVA_HOME=\"/Applications/Android Studio.app/Contents/jbr/Contents/Home\"" >&2
    echo "or add JAVA_HOME to your shell profile." >&2
    exit 1
fi

exec "$@"