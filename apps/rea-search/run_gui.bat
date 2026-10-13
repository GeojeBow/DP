@echo off
rem Run as administrator for the fast NTFS (MFT) indexer.
cd /d "%~dp0"
python -m rea_search %*
