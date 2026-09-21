const REQUIRED_MAJOR = 24;
const current = process.versions.node;
const major = Number(current.split('.')[0]);

if (major < REQUIRED_MAJOR) {
  console.error(
    [
      '',
      `[sitebot] Se requiere Node ${REQUIRED_MAJOR}+ y estás usando Node v${current}.`,
      'Dependencias como Crawlee necesitan require() de ESM (Node 22.12+/24).',
      '',
      'Ejecuta:',
      '  nvm use        # usa el .nvmrc del proyecto (24)',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
