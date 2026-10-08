import { getAvailableApiSites } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();

  const encoder = new TextEncoder();
  const sites = await getAvailableApiSites();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        );
      };

      try {
        send({
          type: 'start',
          query,
          totalSources: sites.length,
          timestamp: Date.now(),
        });

        let totalResults = 0;
        let completedSources = 0;

        await Promise.all(
          sites.map(async (site) => {
            try {
              const results = await searchFromApi(site, query);
              completedSources += 1;
              totalResults += results.length;
              send({
                type: 'source_result',
                source: site.key,
                sourceName: site.name,
                results,
                timestamp: Date.now(),
              });
            } catch (err) {
              completedSources += 1;
              send({
                type: 'source_error',
                source: site.key,
                sourceName: site.name,
                error: err instanceof Error ? err.message : '搜索失败',
                timestamp: Date.now(),
              });
            }
          })
        );

        send({
          type: 'complete',
          totalResults,
          completedSources,
          timestamp: Date.now(),
        });
      } catch (err) {
        send({
          type: 'source_error',
          source: 'server',
          sourceName: 'server',
          error: err instanceof Error ? err.message : '未知错误',
          timestamp: Date.now(),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
