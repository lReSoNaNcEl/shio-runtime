"""Measure synchronized CUDA phases for the local qualification reports."""

import json
from contextlib import contextmanager
from time import perf_counter

import torch


@contextmanager
def measure(results, name, *, cuda=True):
    if cuda:
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()
    start = perf_counter()
    yield
    if cuda:
        torch.cuda.synchronize()
    entry = {"ms": round((perf_counter() - start) * 1000, 2)}
    if cuda:
        entry["peakCudaAllocatedBytes"] = torch.cuda.max_memory_allocated()
        entry["peakCudaReservedBytes"] = torch.cuda.max_memory_reserved()
    results[name] = entry
    print(json.dumps({name: entry}), flush=True)
