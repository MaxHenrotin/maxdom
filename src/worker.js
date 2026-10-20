export default {
  async fetch(request, env) {
    return Response.json({ error: 'not found' }, { status: 404 });
  },
};
