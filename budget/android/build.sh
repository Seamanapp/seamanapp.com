#!/usr/bin/env bash
# Build the Family Budget APK from ../index.html — no Gradle, no Android Studio.
#
# Needs the Debian/Ubuntu Android tool packages:
#   apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
# plus a JDK. Output: build/FamilyBudget.apk
#
# SIGNING: Android only installs an update over an existing install if it is
# signed with the SAME key. Keep release.keystore (never commit it) and pass
# it back in via KEYSTORE / KS_PASS for every future build; a new key means
# uninstall + reinstall, which wipes the app's data (export a backup first).
set -euo pipefail
unset JAVA_TOOL_OPTIONS  # keeps proxy noise out of the build log; nothing here goes online
cd "$(dirname "$0")"

SDK=${ANDROID_SDK:-/usr/lib/android-sdk}
JAR=$SDK/platforms/android-23/android.jar
BT=$SDK/build-tools/debian
KEYSTORE=${KEYSTORE:-release.keystore}
KS_PASS=${KS_PASS:-familybudget}

rm -rf build && mkdir -p build/gen build/classes build/assets
cp ../index.html build/assets/index.html

echo "» resources"
aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$JAR"

echo "» compile"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -d build/classes \
  $(find src build/gen -name '*.java')

echo "» dex"
"$BT/dx" --dex --min-sdk-version=21 --output=build/classes.dex build/classes

echo "» package"
# -0 arsc: resources.arsc must be stored uncompressed for targetSdk >= 30.
aapt package -f -0 arsc -M AndroidManifest.xml -S res -A build/assets -I "$JAR" -F build/unsigned.apk
(cd build && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 build/unsigned.apk build/aligned.apk

if [ ! -f "$KEYSTORE" ]; then
  echo "» new signing key: $KEYSTORE (back it up!)"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias familybudget -keyalg RSA -keysize 3072 -validity 36500 \
    -dname "CN=Family Budget, O=Seaman App, C=PH" >/dev/null 2>&1
fi

echo "» sign"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias familybudget \
  --out build/FamilyBudget.apk build/aligned.apk
apksigner verify --print-certs build/FamilyBudget.apk | head -3
ls -l build/FamilyBudget.apk
