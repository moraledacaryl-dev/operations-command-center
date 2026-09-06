from app.api_read_boundary import _matches_public_prefix


def test_public_prefix_matches_only_exact_route_tree():
    prefix = "/api/property-media"
    assert _matches_public_prefix("/api/property-media", prefix)
    assert _matches_public_prefix("/api/property-media/dashboard_hero/content", prefix)
    assert not _matches_public_prefix("/api/property-mediaevil", prefix)
    assert not _matches_public_prefix("/api/property-media-v2", prefix)
    assert not _matches_public_prefix("/api/property", prefix)
