#!/usr/bin/env bash
set -euo pipefail
: "${COMPILER_DIR:?Set COMPILER_DIR to the exact freshly built Java compiler checkout}"
cd "$(dirname "$0")/.."
export JAVA_HOME=/Library/Java/JavaVirtualMachines/graalvm-25.jdk/Contents/Home
mvn -q -f "$COMPILER_DIR/pom.xml" dependency:build-classpath -Dmdep.outputFile="$PWD/integration/classpath.txt"
mkdir -p integration/classes
"$JAVA_HOME/bin/javac" -cp "$COMPILER_DIR/target/classes:$(cat integration/classpath.txt)" -d integration/classes integration/InspectorHost.java
