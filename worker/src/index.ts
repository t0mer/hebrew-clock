export default {
  async fetch(): Promise<Response> {
    return new Response("OK");
  },
} satisfies ExportedHandler;
