import {updateFeed} from '../../../../lib/update-feed.js';

export default async function handler(_request, response) {
  return updateFeed('win32', response);
}
