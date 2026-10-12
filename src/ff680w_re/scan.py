"""Experimental scan helpers for live FF-680W testing."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic, sleep
from contextlib import suppress
from tempfile import TemporaryFile

from .errors import ProtocolError
from .profiles import GrayJpegScanPlan, default_ff680w_gray_jpeg_scan_plan, default_ff680w_jpeg_scan_plan
from .session import EscI2Session


@dataclass(slots=True)
class ScanProbeResult:
    plan: GrayJpegScanPlan
    para_ok: bool
    trdt_ok: bool
    mechanical_ok: bool
    image_bytes: int
    output_path: Path
    block_headers: list[str] = field(default_factory=list)
    terminal_tokens: list[str] = field(default_factory=list)


@dataclass(slots=True)
class CapturedImage:
    sheet: int
    side: str
    path: Path
    size: int


def _check_errors(reply: object, stage: str) -> None:
    for token in reply.tokens:
        if token.name.lower() in {"err", "atn", "nrd"}:
            raise ProtocolError(f"{stage}: {token.name}={token.text.strip()}")


def run_jpeg_scan(
    session: EscI2Session, *, output_dir: Path, mode: str = "color",
    duplex: bool = False, timeout: float = 120, idle_delay_ms: int = 100,
    dpi: int = 300, max_sheets: int = 0, paper: str = "letter", quality: int = 90,
    deskew: bool = False, auto_crop: bool = False, double_feed: bool = True,
) -> list[CapturedImage]:
    """Save each completed sheet side immediately, retaining it if the job fails."""
    if timeout <= 0 or idle_delay_ms < 0:
        raise ProtocolError("timeout must be positive and idle delay must be nonnegative")
    if output_dir.exists():
        raise ProtocolError(f"output directory already exists; choose a new directory: {output_dir}")
    try:
        plan = default_ff680w_jpeg_scan_plan(
            mode=mode, duplex=duplex, dpi=dpi, max_sheets=max_sheets,
            paper=paper, quality=quality, deskew=deskew, auto_crop=auto_crop,
            double_feed=double_feed,
        )
    except ValueError as exc:
        raise ProtocolError(str(exc)) from exc
    output_reserved = False
    try:
        output_dir.mkdir(parents=True, exist_ok=False)
        output_reserved = True
        with TemporaryFile(dir=output_dir) as probe:
            probe.write(b"output check")
            probe.flush()
    except OSError as exc:
        if output_reserved:
            with suppress(OSError):
                output_dir.rmdir()
        raise ProtocolError(f"cannot prepare scan output: {exc}") from exc
    buffers = {"front": bytearray(), "back": bytearray()}
    completed: dict[str, list[CapturedImage]] = {"front": [], "back": []}
    side = "front"
    job_done = False
    start_attempted = False
    scan_error: BaseException | None = None
    cleanup_errors: list[str] = []
    deadline = monotonic() + timeout
    try:
        _check_errors(session.status(), "scanner status")
        # An ordinary ADF job starts via PARA/TRDT. LOAD is a separate manual
        # feeder action in SANE; DocumentMode in the old model scaffold does
        # not establish device support, and this FF-680W CAPA omits LOAD.
        para = session.set_parameters(plan.to_payload())
        _check_errors(para, "scan parameters")
        if not any(t.name == "par" and t.text == "OK  " for t in para.tokens):
            raise ProtocolError("scanner did not accept the scan parameters")
        start_attempted = True
        _check_errors(session.transfer_data_ready(), "scan start")
        while monotonic() < deadline:
            # image_block drains all advertised data, including terminal blocks.
            block = session.image_block()
            _check_errors(block, "image transfer")
            for token in block.tokens:
                if token.name == "typ":
                    if token.text not in {"IMGA", "IMGB"}:
                        raise ProtocolError(f"unknown image side: {token.text}")
                    side = "back" if token.text == "IMGB" else "front"
            if side == "back" and not duplex:
                raise ProtocolError("scanner returned a back image during a single-sided job")
            buffers[side].extend(block.data_block)
            if any(t.name == "pen" for t in block.tokens):
                data = bytes(buffers[side])
                if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
                    raise ProtocolError(f"incomplete JPEG received for {side} image")
                index = len(completed[side]) + 1
                path = output_dir / f"{index:03d}-{side}.jpg"
                file_created = False
                try:
                    with path.open("xb") as output:
                        file_created = True
                        output.write(data)
                except OSError as exc:
                    # Remove only the incomplete file owned by this write, never
                    # an existing file that caused exclusive creation to fail.
                    if file_created:
                        with suppress(OSError):
                            path.unlink()
                    raise ProtocolError(f"cannot save completed scan {path}: {exc}") from exc
                completed[side].append(CapturedImage(index, side, path, len(data)))
                buffers[side].clear()
                if max_sheets and index > max_sheets:
                    raise ProtocolError(f"scanner exceeded the requested sheet limit on {side} side")
            if any(t.name == "lft" and t.text == "d000" for t in block.tokens):
                job_done = True
                break
            if not block.data_block and idle_delay_ms:
                sleep(idle_delay_ms / 1000)
        if not job_done:
            raise ProtocolError("scan timed out before the scanner ended the job")
        if any(buffers.values()) or not completed["front"]:
            raise ProtocolError("scan ended with incomplete or missing image data")
        if duplex and len(completed["front"]) != len(completed["back"]):
            raise ProtocolError("scan ended without matching front and back images")
    except BaseException as exc:
        scan_error = exc
    finally:
        if start_attempted and not job_done:
            try:
                session.cancel()
            except Exception as exc:
                cleanup_errors.append(f"CAN: {exc}")
        try:
            _check_errors(session.finish(), "scanner finalize")
        except Exception as exc:
            cleanup_errors.append(f"FIN: {exc}")

    if scan_error is not None or cleanup_errors:
        saved = completed["front"] + completed["back"]
        details: list[str] = []
        if cleanup_errors:
            details.append("scanner cleanup failed (" + "; ".join(cleanup_errors) + ")")
        if saved:
            details.append(f"Saved {len(saved)} completed image(s) in {output_dir}; the scan job did not complete cleanly.")
        else:
            with suppress(OSError):
                output_dir.rmdir()
        context = ". ".join(details)
        if scan_error is not None:
            if not isinstance(scan_error, Exception):
                if context:
                    scan_error.add_note(context)
                raise scan_error
            if context:
                raise ProtocolError(f"{scan_error}. {context}") from scan_error
            raise scan_error
        raise ProtocolError(context)

    results: list[CapturedImage] = []
    for index, front in enumerate(completed["front"]):
        for image_side in (("front", "back") if duplex else ("front",)):
            results.append(front if image_side == "front" else completed["back"][index])
    return results


def run_gray_scan_probe(
    session: EscI2Session,
    *,
    output_path: Path,
    polls: int = 200,
    delay_ms: int = 0,
    run_mechanical: bool = True,
) -> ScanProbeResult:
    plan = default_ff680w_gray_jpeg_scan_plan()
    mechanical_ok = True

    if run_mechanical:
        for action in plan.mechanical_actions:
            reply = session.mechanical(action)
            if reply.header_block[:4] != b"MECH":
                mechanical_ok = False

    para_reply = session.set_parameters(plan.to_payload())
    trdt_reply = session.transfer_data_ready()

    image_bytes = bytearray()
    block_headers: list[str] = []
    terminal_tokens: list[str] = []

    for _ in range(polls):
        if delay_ms:
            sleep(delay_ms / 1000)

        block = session.image_block()
        block_headers.append(block.header_block[:12].decode("ascii", errors="replace"))
        image_bytes.extend(block.data_block)

        names = [token.name for token in block.tokens]
        if any(name in {"pen", "err", "atn", "lft"} for name in names):
            terminal_tokens.extend(names)
            break

    output_path.write_bytes(image_bytes)

    return ScanProbeResult(
        plan=plan,
        para_ok=any(token.name == "par" and token.text == "OK  " for token in para_reply.tokens),
        trdt_ok=trdt_reply.header_block[:4] == b"TRDT",
        mechanical_ok=mechanical_ok,
        image_bytes=len(image_bytes),
        output_path=output_path,
        block_headers=block_headers,
        terminal_tokens=terminal_tokens,
    )
