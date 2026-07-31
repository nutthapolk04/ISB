/**
 * Resolve JDK 21 for Android/Gradle builds.
 * Gradle 8.14 cannot RUN on Java 25+ (incl. brew's default openjdk = 26).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const JDK21_CANDIDATES = [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
].filter(Boolean);

export function javaMajorVersion(javaBin) {
    const result = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
    const text = `${result.stderr ?? ''}${result.stdout ?? ''}`;
    const match = /version "(\d+)/.exec(text);
    return match ? Number(match[1]) : null;
}

export function resolveJava21Home() {
    for (const home of JDK21_CANDIDATES) {
        const javaBin = path.join(home, 'bin/java');
        if (!existsSync(javaBin)) continue;
        if (javaMajorVersion(javaBin) === 21) return home;
    }
    return null;
}

export function describeJavaProblem() {
    const defaultJava = spawnSync('java', ['-version'], { encoding: 'utf8' });
    const major = defaultJava.status === 0 ? javaMajorVersion('java') : null;

    if (major && major >= 25) {
        return `
Gradle 8.14 cannot run on Java ${major} (class file major version ${60 + major}).
You likely ran: brew install openjdk   ← installs Java ${major}

Fix — install JDK 21 only:
  brew install openjdk@21
  export JAVA_HOME="$(/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home)"
  export PATH="$JAVA_HOME/bin:$PATH"

Then: cd kiosk && npm run release
`;
    }

    return `
Android build requires JDK 21.

  brew install openjdk@21
  export JAVA_HOME="$(/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home)"
  export PATH="$JAVA_HOME/bin:$PATH"

Then: cd kiosk && npm run release
`;
}

export function java21Env(baseEnv = process.env) {
    const home = resolveJava21Home();
    if (!home) return null;
    return {
        ...baseEnv,
        JAVA_HOME: home,
        PATH: `${path.join(home, 'bin')}:${baseEnv.PATH ?? ''}`,
    };
}
