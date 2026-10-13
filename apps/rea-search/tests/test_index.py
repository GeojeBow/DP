import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rea_search.index import IndexBuilder  # noqa: E402
from rea_search import walker  # noqa: E402


def sample():
    b = IndexBuilder()
    b.add_root("r", "C:")
    b.add("docs", "r", "Documents", True)
    b.add("rep", "docs", "Report 2026.docx", False)
    b.add("rep2", "docs", "report-final.PDF", False)
    b.add("pics", "r", "Pictures", True)
    b.add("cat", "pics", "cat.jpg", False)
    b.add("dog", "pics", "dog.png", False)
    b.add("kr", "docs", "회의록_보고서.txt", False)
    return b.build()


class IndexTest(unittest.TestCase):
    def setUp(self):
        self.idx = sample()

    def names(self, q):
        return [self.idx.node(k)[0] for k in self.idx.search(q)]

    def test_substring_case_insensitive_and_sorted(self):
        self.assertEqual(self.names("report"), ["Report 2026.docx", "report-final.PDF"])

    def test_and_terms(self):
        self.assertEqual(self.names("rep final"), ["report-final.PDF"])

    def test_or(self):
        self.assertEqual(sorted(self.names("cat | dog")), ["cat.jpg", "dog.png"])

    def test_not(self):
        self.assertEqual(self.names("report !pdf"), ["Report 2026.docx"])

    def test_wildcard(self):
        self.assertEqual(self.names("*.jpg"), ["cat.jpg"])
        self.assertEqual(self.names("d?g.*"), ["dog.png"])

    def test_ext_and_type_filters(self):
        self.assertEqual(sorted(self.names("ext:jpg;png")), ["cat.jpg", "dog.png"])
        self.assertEqual(self.names("folder:"), ["C:", "Documents", "Pictures"])  # drives are folders too
        self.assertNotIn("Documents", self.names("file:"))

    def test_path_term(self):
        self.assertEqual(self.names("pictures\\ cat"), ["cat.jpg"])

    def test_korean(self):
        self.assertEqual(self.names("보고서"), ["회의록_보고서.txt"])

    def test_full_path(self):
        k = self.idx.search("cat.jpg")[0]
        self.assertEqual(self.idx.path(k).replace("/", "\\"), "C:\\Pictures\\cat.jpg")

    def test_live_create_rename_delete_and_compact(self):
        self.idx.upsert("new", "pics", "bird.gif", False)
        self.assertEqual(self.names("bird"), ["bird.gif"])
        self.idx.upsert("cat", "pics", "tiger.jpg", False)  # rename
        self.assertEqual(self.names("cat"), [])
        self.assertEqual(self.names("tiger"), ["tiger.jpg"])
        self.idx.upsert("pics", "r", "Photos", True)  # folder rename changes child paths
        self.assertIn("Photos", self.idx.path(self.idx.search("dog")[0]))
        self.idx.remove("dog")
        self.assertEqual(self.names("dog"), [])
        c = self.idx.compact()
        self.assertEqual(c.overlay_size, 0)
        self.assertEqual([c.node(k)[0] for k in c.search("*.gif | tiger")], ["bird.gif", "tiger.jpg"])

    def test_empty_query_lists_everything(self):
        self.assertEqual(len(self.idx.search("")), len(self.idx))


class WalkerTest(unittest.TestCase):
    def test_walk(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "a", "b"))
            open(os.path.join(d, "a", "b", "hello.txt"), "w").close()
            b = IndexBuilder()
            walker.walk_into(b, [d])
            idx = b.build()
            k = idx.search("hello")[0]
            self.assertEqual(idx.path(k), os.path.join(d, "a", "b", "hello.txt"))


if __name__ == "__main__":
    unittest.main()
