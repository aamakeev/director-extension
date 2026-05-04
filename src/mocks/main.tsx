import { render } from 'preact';

import { Playground } from './playground';

const root = document.getElementById('app');
if (root) {
  render(<Playground />, root);
}
