const REQUIRED_MAJOR = 24;
const current = process.versions.node;
const major = Number(current.split('.')[0]);

if (major < REQUIRED_MAJOR) {
  console.error(
    [
      '',
      `[sitebot] Se requiere Node ${REQUIRED_MAJOR}+ y estás usando Node v${current}.`,
      '',
      'Ejecuta:',
      '  nvm use        # usa el .nvmrc del proyecto (24)',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
