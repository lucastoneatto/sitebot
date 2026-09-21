import { NextResponse } from 'next/server';
import { api } from '@/lib/api';

/**
 * Forwards the detail of an indexed page to the client. api.getPage() is
 * server-only (it uses the httpOnly session cookie), so the detail modal in
 * the browser goes through this route instead of calling the API directly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; pageId: string }> },
) {
  const { id, pageId } = await params;
  try {
    const page = await api.getPage(id, pageId);
    return NextResponse.json(page);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
